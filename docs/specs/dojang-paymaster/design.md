# Tasarım — Dojang-gated ERC-4337 paymaster kiti

Tarih: 2026-09-29 · Durum: taslak, onay bekliyor · Gereksinimler: [requirements.md](requirements.md)

## Bağlam

```
 Kullanıcı EOA (7702 → Simple7702Account)
        │ UserOp (+ eip7702Auth ilk seferde)
        ▼
 GIWA bundler (Rundler) ──simulate/validate──► EntryPoint v0.9 (0x4337…D009)
                                                  │ validatePaymasterUserOp / postOp
                                                  ▼
                                   DojangVerifiedPaymaster  (BU KİT)
                                                  │ view çağrıları (STO-033, stake gerekir)
          ┌───────────────────────┬───────────────┼───────────────────┬─────────────────┐
          ▼                       ▼               ▼                   ▼                 ▼
    DojangScroll (0.5.1)    SchemaBook    DojangAttesterBook   AttestationIndexer   EAS (0x42…21)
    _schemaBook/_dojangAttesterBook/_indexer getter'ları → güncel yapılandırma
```

Sistemin içinde: `DojangAddressVerifier` kütüphanesi, `DojangVerifiedPaymaster`, TS script'leri (deploy, opcode denetimi, E2E), testler ve dokümanlar. Dışarıda kalanlar: Dojang kontratları, EntryPoint, bundler ve Simple7702Account. Simple7702Account'ı biz deploy edebiliriz ama kodunu değiştirmeyiz.

## Teknoloji seçimi (tech-select yöntemi)

**İş yükü profili:** az sayıda kontrat. Güvenlik kritik validation mantığı, bol birim ve fuzz testi, GIWA fork testi ve Blockscout doğrulaması gerekiyor. Anahtar Windows DPAPI'de ve kural gereği argv/env'e çıkamaz. Tek geliştirici + Claude; mevcut TS/viem deneyimi var.

Ağırlıklar puanlamadan önce belirlendi: güvenli anahtar kullanımı 5, test/fuzz/fork gücü 4, ekosistem uyumu (Dojang ve AA kütüphaneleri) 4, ekip deneyimi 3, doğrulama/deploy kolaylığı 2.

| Kriter | Ağ. | A: Foundry + TS/viem script'leri | B: Hardhat 3 (TS) | C: Ape (Python) |
|---|---|---|---|---|
| Anahtar güvenliği | 5 | 5: deploy'u viem yapar, DPAPI signer süreç içinde (mevcut desen) | 5: TS süreç içinde | 3: Python'da DPAPI yeniden yazılmalı |
| Test/fuzz/fork | 4 | 5: forge fuzz, `--fork-url`, gas report | 4: fork var, fuzz zayıf | 3 |
| Ekosistem uyumu | 4 | 5: Dojang, EAS, account-abstraction Foundry kullanıyor | 3 | 2 |
| Ekip deneyimi | 3 | 4: viem biliniyor, forge kurulu | 4 | 2 |
| Doğrulama/deploy | 2 | 4: `forge verify-contract --verifier blockscout` | 4 | 3 |
| **Toplam** | | **83** | 71 | 48 |

**Seçim: A.** Kontratlar ve testler Foundry'de, zincire yazan her şey viem ile TS'de yazılır. Bu sayede anahtar hiçbir zaman `forge script --private-key` yoluna girmez. B'nin anahtar tarafı eşdeğer ama AA ve Dojang referans kodlarıyla uyumu ve fuzz desteği zayıf. C yeni bir signer yazmayı gerektiriyor. Kararın kaydı ADR 0001 olarak repoya girecek.

## Bileşenler

### `DojangAddressVerifier` (Solidity library)
**Sorumluluk:** bir adres ve attester ID listesi için saat okumadan Verified Address attestation'ını çözümler.

```solidity
struct Verdict { bool verified; uint48 validUntil; bytes32 attesterId; bytes32 uid; }
function check(IDojangScroll scroll, address account, bytes32[] memory attesterIds)
    internal view returns (Verdict memory);
```

Akış (FR-1…FR-8), her attester ID için:
1. `schemaUid = scroll._schemaBook().getSchemaUid(ADDRESS_DOJANG_ID)`. Liste başına bir kez okunur.
2. `attester = scroll._dojangAttesterBook().getAttester(id)`. Sonuç 0 ise sonraki ID'ye geçilir. Güncel attester okunduğu için rotate edilen ID'lerde DojangScroll ile aynı davranır.
3. `uid = scroll._indexer().getAttestationUid(schemaUid, attester, account)`. Sonuç 0 ise sonraki ID.
4. `a = EAS.getAttestation(uid)`. Şunlar kontrol edilir: `a.uid == uid`, `a.revocationTime == 0`, `a.recipient == account`, `a.schema == schemaUid`, `a.attester == attester`, `a.data.length == 32 && uint256(bytes32(a.data)) == 1`.
5. İlk geçerli ID döner. `validUntil = a.expirationTime == 0 ? 0 : min(a.expirationTime, 2**47 - 1)`. v0.9 en üst biti blok numarası kipi için ayırıyor.

Revert etmez; doğrulanamayan her durum `verified=false` döner. Bunun iki nedeni var: validation'da açıklayıcı reddi paymaster yapar, ve kütüphane başka bağlamlarda da (örneğin bir hesabın `validateUserOp`'unda) kullanılabilir. `ADDRESS_DOJANG_ID` Dojang `Types.sol`'daki şema kimliğidir; implementasyonda kaynaktan birebir alınıp testle sabitlenecek.

**Bilinçli fark:** DojangScroll'un expiry'yi validation anında değerlendirmesi yerine süre EntryPoint'e bırakılır (FR-7). Veri alanındaki bool kontrol edilir (FR-6).

### `DojangVerifiedPaymaster` (EntryPoint v0.9 `BasePaymaster` türevi)
**Sorumluluk:** doğrulanmış gönderenlerin UserOp'larını bütçe sınırları içinde sponsorlar.

Durum (storage):
- `IDojangScroll immutable scroll`
- `bytes32[] attesterIds` (≤ 8, owner yönetir)
- `uint256 maxCostPerOp`, `uint256 maxCostPerAccount`
- `uint256 epoch`; `mapping(uint256 epoch => mapping(address sender => uint256 spentWei)) spent`

`_validatePaymasterUserOp(op, hash, maxCost)`:
1. `maxCost > maxCostPerOp` ise `revert MaxCostPerOpExceeded` (FR-12).
2. `spent[epoch][sender] + maxCost > maxCostPerAccount` ise `revert AccountBudgetExceeded` (FR-13).
3. `v = DojangAddressVerifier.check(scroll, sender, attesterIds)`; doğrulanmamışsa `revert SenderNotVerified` (FR-10).
4. `context = abi.encode(sender, epoch)`, `validationData = _packValidationData(false, v.validUntil, 0)` döner (FR-11).

`_postOp(mode, context, actualGasCost, actualUserOpFeePerGas)`: `spent[ctxEpoch][sender] += actualGasCost` (FR-14). Validation'daki epoch context'e konur; böylece arada yapılan bir sıfırlama yanlış döneme yazılmaz.

Owner işlemleri (FR-15…18): `setAttesterIds`, `setLimits`, `advanceEpoch`, ayrıca BasePaymaster'dan gelen `addStake/unlockStake/withdrawStake/deposit/withdrawTo`.

Validation'da `block.timestamp`, `block.number` veya ERC-7562 yasaklı başka bir opcode kullanılmaz. Paymaster kendi storage'ına yazmaz; yazma yalnız `postOp`'ta olur. Okumalar kendi storage'ı (STO-031) ve dış view'lar (STO-033) içindir; ikisi de stake gerektirir.

### Script'ler (TypeScript, viem, Node 22)
- `signer.ts`: Windows DPAPI'den anahtarı süreç içi pipe ile açar, kullanımdan sonra buffer'ı temizler (FR-24). Desen `giwa-automation-core/src/wallet-key.ts` ile aynı. Anahtar dosyasının yolu repo dışındadır; config'te yalnız yol durur.
- `deploy.ts` (FR-20, FR-21): Simple7702Account deterministik deploy (varsa atlanır) → paymaster deploy → `setAttesterIds` → `addStake` → `deposit`. Her adımda önce simülasyon yapılır ve bütçe tavanı uygulanır.
- `opcode-audit.ts` (FR-19): EntryPoint `simulateValidation` yolunu değil, paymaster'ın `validatePaymasterUserOp` çağrısını EntryPoint adresinden `debug_traceCall` ile izler. Yasaklı opcode'ları çağrı derinliğiyle listeler.
- `e2e.ts` (FR-22, FR-23): viem `toSimple7702SmartAccount` + bundler client ile sponsorlu UserOp akışını, ardından yardımcı cüzdanla negatif akışı çalıştırır.
- `deployments/91342.json`: adresler, deploy tx hash'leri ve Blockscout bağlantıları.

## Veri modeli

Zincir dışında kalıcı veri yok; `deployments/91342.json` dışında durum tutulmaz. Zincirdeki paymaster durumu yukarıda anlatıldı. Yardımcı cüzdan anahtarı ana cüzdanla aynı DPAPI korumasıyla repo dışında saklanır.

## Hata davranışı

| Nokta | Başarısızlık | Davranış |
|---|---|---|
| Validation dış çağrıları | Dojang kontratı revert eder | Validation revert eder, op sponsorlanmaz, bundler reddeder. Kullanıcı hata kodunu görür |
| Attester silinmiş (0 adres) | — | O ID atlanır; hiçbiri geçerli değilse `SenderNotVerified` |
| Attestation süresi validation'dan sonra dolmuş | — | EntryPoint `validUntil` ile reddeder; paymaster'a ücret yansımaz |
| `postOp` | Reverti engellenecek kadar basit (tek toplama) | v0.7+ postOp revert'ü op'u geri alır; bu yüzden postOp yalnız aritmetik yapar |
| Script: RPC/bundler hatası | Zaman aşımı 30 s | Yeniden gönderim yok. Tx hash kaydedilir, sonraki çalıştırmada durum okunarak devam edilir |
| Script: simülasyon başarısız | — | İmza atılmaz, script hatayla çıkar |
| Script: bütçe tavanı aşılır | Tahmini maliyet > yapılandırılmış tavan | İmza atılmaz |

## Güvenlik

- **Güvenilmeyen girdiler:** UserOp alanları (`sender`, `maxCost`, `paymasterAndData` fazlası). Paymaster ek veri kabul etmez; `paymasterAndData` fazlası yok sayılır.
- **Bütçe boşaltma:** doğrulanmış tek bir hesabın deposit'i boşaltması FR-12 ve FR-13 ile sınırlanır. Sybil koruması Dojang'ın kendisi: her doğrulanmış adres ayrı bir KYC'li kişiye karşılık gelir. Testnet'te bu attestation'ı Playground veriyor olabilir; bu garanti değil (README'de açıkça yazılacak).
- **Yetki:** owner işlemleri `Ownable` ile korunur. Stake/deposit çekme yalnız owner'dadır.
- **Dojang yapılandırma değişikliği:** DojangScroll admin'i schemaBook, attesterBook veya indexer'ı değiştirirse paymaster otomatik izler. Bu bir güven varsayımıdır (Dunamu'ya güven); README'de belirtilecek.
- **Sırlar:** FR-24 geçerli. Public repoda ana cüzdan adresi ile GitHub hesabının ilişkisi E2E tx hash'leri yayımlanırsa açığa çıkar; bu kullanıcı kararı (açık soru).

## İzlenebilirlik

| FR | Bileşen | Doğrulama |
|---|---|---|
| 1–8 | DojangAddressVerifier | Birim testleri (mock Dojang) + fork testi |
| 9–14 | DojangVerifiedPaymaster | Birim testleri (gerçek EntryPoint v0.8 kodu yerelde) + E2E |
| 15–18 | DojangVerifiedPaymaster | Birim testleri |
| 19 | opcode-audit.ts | Canlı iz çıktısı, NFR-1 |
| 20, 21, 25 | deploy.ts, forge verify | deployments/91342.json + Blockscout |
| 22, 23 | e2e.ts | Receipt + bundler ret mesajı, NFR-2 |
| 24 | signer.ts | Birim testi (geçici DPAPI fixture) + repo taraması (NFR-8) |
| 26–28 | README, docs/pattern.md, docs/rehber-tr.md | Gözden geçirme |
