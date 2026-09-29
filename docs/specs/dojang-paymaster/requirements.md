# Gereksinimler — Dojang-gated ERC-4337 paymaster kiti

Tarih: 2026-09-29 · Durum: taslak, onay bekliyor

## Problem

GIWA'da EntryPoint v0.8 (`0x433709009B8330FDa32311DF1C2AFA402eD8D009`), resmi bundler (`https://sepolia-bundler.giwa.io`, Rundler) ve Dojang birlikte bulunuyor. Ancak `DojangScroll.isVerified()` expiry kontrolü için `block.timestamp` okuyor. ERC-7562 bu opcode'u ERC-4337 validation içinde yasaklıyor. Sonuç olarak "yalnız Dojang doğrulamalı kullanıcıların gas'ını ödeyen" bir paymaster, bariz yoldan kurulduğunda bundler'a gönderimde reddediliyor. Kaynak: [giwa-io/dojang#37](https://github.com/giwa-io/dojang/issues/37), kontrol tarihi 2026-09-29. Issue açık. Önerilen raw getter PR'ı (#38) review almadı. Çözüm yolu tarif edilmiş ve issue sahibinin kapalı bir üründe çalıştığı belirtilmiş, fakat açık kaynak, test edilmiş, yeniden kullanılabilir bir referans bulunamadı.

Bu kit o referansı sağlar: 4337'de kullanılabilir bir Dojang okuma kütüphanesi, onu kullanan bir paymaster ve GIWA Sepolia üzerinde kanıtlanmış uçtan uca akış.

## Fonksiyonel gereksinimler

**Doğrulama kütüphanesi**
- FR-1: Kütüphane, bir adres ve attester ID için Dojang Verified Address attestation'ını `block.timestamp` okumadan çözümler.
- FR-2: Kütüphane attester adresini, şema UID'sini ve indexer adresini her çağrıda DojangScroll'un güncel yapılandırmasından okur.
- FR-3: Kütüphane uid'si sıfır olan attestation'ı "doğrulanmamış" olarak döndürür.
- FR-4: Kütüphane iptal edilmiş attestation'ı (`revocationTime != 0`) "doğrulanmamış" olarak döndürür.
- FR-5: Kütüphane alıcısı, şeması veya attester'ı beklenenle eşleşmeyen attestation'ı "doğrulanmamış" olarak döndürür.
- FR-6: Kütüphane verisi tam olarak ABI kodlanmış `true` olmayan attestation'ı "doğrulanmamış" olarak döndürür. Bu DojangScroll'dan bilinçli olarak daha katıdır.
- FR-7: Kütüphane geçerli attestation için `expirationTime` değerini `uint48 validUntil` olarak döndürür. 0 değeri süresiz demektir; `uint48` üst sınırını aşan değer üst sınıra kırpılır.
- FR-8: Kütüphane birden fazla attester ID verildiğinde ilk geçerli attestation'ı kabul eder.

**Paymaster (EntryPoint v0.8)**
- FR-9: Paymaster, `sender` adresi kabul edilen attester ID'lerinden biri için doğrulanmışsa UserOp'u sponsorlar.
- FR-10: Paymaster doğrulanmamış `sender` için validation'da reddeder.
- FR-11: Paymaster, attestation'ın expiry değerini `validationData` içindeki `validUntil` alanına yazar.
- FR-12: Paymaster tek bir UserOp'un `maxCost` değeri yapılandırılmış üst sınırı aşarsa reddeder.
- FR-13: Paymaster bir `sender` için mevcut dönemde harcanan gas maliyeti ile yeni `maxCost`'un toplamı hesap başı limiti aşarsa reddeder.
- FR-14: Paymaster `postOp` içinde gerçek gas maliyetini `sender`'ın mevcut dönem harcamasına ekler.
- FR-15: Owner, kabul edilen attester ID listesini (en fazla 8) değiştirebilir.
- FR-16: Owner, UserOp başı ve hesap başı limitleri değiştirebilir.
- FR-17: Owner dönem sayacını artırarak tüm hesap harcamalarını sıfırlayabilir.
- FR-18: Owner olmayan adres FR-15/16/17 işlemlerini yapamaz.

**Araçlar ve kanıt**
- FR-19: Opcode denetim script'i, verilen bir UserOp için paymaster validation çağrısını `debug_traceCall` ile izler ve ERC-7562 yasaklı opcode'larını listeler.
- FR-20: Deploy script'i paymaster'ı GIWA Sepolia'ya deploy eder, stake ve deposit yatırır, attester ID'lerini ayarlar.
- FR-21: Deploy script'i GIWA'da yoksa `Simple7702Account` (eth-infinitism v0.8) implementasyonunu deterministik adrese deploy eder.
- FR-22: E2E script'i doğrulanmış bir EOA'dan EIP-7702 delegasyonuyla sponsorlu bir UserOp gönderir ve receipt'i doğrular.
- FR-23: E2E script'i doğrulanmamış bir EOA'nın UserOp'unun bundler tarafından reddedildiğini doğrular.
- FR-24: Script'ler imza anahtarını yalnız işlem anında bellekte açar. Anahtar argv'ye, ortam değişkenine, dosyaya veya çıktıya yazılmaz.
- FR-25: Deploy edilen kontratlar Blockscout'ta kaynak kodu doğrulanmış olarak yayımlanır.

**Doküman**
- FR-26: README (İngilizce), paymaster'ı kendi projesine entegre etmek isteyen bir geliştiricinin kurulum, deploy ve kullanım adımlarını içerir.
- FR-27: Ayrı bir belge #37'deki problemi, çözüm desenini ve DojangScroll'dan farkları (FR-6, FR-7) kaynaklarıyla açıklar.
- FR-28: Kısa bir Türkçe rehber aynı akışı özetler.

## Fonksiyonel olmayan gereksinimler

| ID | Özellik | Ölçü | Hedef |
|---|---|---|---|
| NFR-1 | ERC-7562 uyumu | Validation izinde yasaklı opcode sayısı (FR-19 script'i) | 0 |
| NFR-2 | Bundler kabulü | Doğrulanmış E2E UserOp'un `eth_sendUserOperation` sonucu | Kabul edilir, 60 s içinde receipt `success: true` |
| NFR-3 | Validation gas | 1 attester ID için `validatePaymasterUserOp` gas'ı (forge gas report) | ≤ 120.000 |
| NFR-4 | Validation gas ölçeği | 8 attester ID, hiçbiri eşleşmez (en kötü durum) | ≤ 600.000 |
| NFR-5 | Maliyet | Deploy + konfigürasyon + stake + deposit + E2E toplam ETH çıkışı | ≤ 0,012 ETH (stake/deposit ≈ 0,006 ETH'si geri alınabilir) |
| NFR-6 | Tekrar üretilebilirlik | Temiz klondan `forge build && forge test` (fork testleri hariç) | Windows ve Linux CI'da geçer, ≤ 5 dk |
| NFR-7 | Test izlenebilirliği | FR-1…FR-18'in her biri için en az bir otomatik test | 18/18 |
| NFR-8 | Sır güvenliği | Repo içeriği ve CI loglarında private key / kişisel adres eşleşmesi taraması | 0 bulgu |

## Kapsam dışı

- Mainnet ve gerçek fon. Yalnız GIWA Sepolia (91342).
- Balance, Balance Root ve Verify Code Dojang türleri. Yalnız Verified Address.
- ERC-20 ile gas ödeme (token paymaster), off-chain imzalı "verifying paymaster" modeli.
- Zamana dayalı limitler (günlük/saatlik): validation saat okuyamaz. Dönem sıfırlama owner işlemidir (FR-17).
- Hedef kontrat/fonksiyon allowlist'i (paymaster'ın hangi çağrıları sponsorlayacağını kısıtlamak).
- Web arayüzü, Telegram botu, barındırılan servis.
- npm paketi yayımlama ve giwa-io/dojang'a PR açma. Bunlar ayrı karar; kullanıcı onayı olmadan dış repolara yazılmaz.
- Güvenlik audit'i iddiası. Kit "referans implementasyon, audit edilmedi" olarak sunulur.
- DojangScroll ile birebir semantik eşlik. FR-6 ve FR-7'deki farklar bilinçli.

## Varsayımlar ve bağımlılıklar

| ID | Varsayım | Dayanak | Yanlışsa etkisi |
|---|---|---|---|
| A1 | Bundler'ın minimum paymaster stake'i ≤ 0,001 ETH | EntryPoint'te 6 `StakeLocked` kaydından 5'i 0,001 ETH (2026-09-29 okuması). Çıkarım, bundler config'i görülmedi | Stake artar; cüzdan bakiyesi 0,0332 ETH olduğundan 0,01+ ETH gerekirse bütçe NFR-5'i aşar |
| A2 | GIWA EIP-7702 (type-4) işlemlerini ve Rundler `eip7702Auth`'u destekliyor | OP Stack Isthmus Prague içerir; GIWA için doğrulanmadı | E2E için 7702 yerine sayaç-factory tabanlı smart account gerekir; ama o hesabın Dojang attestation'ı olmaz, bu da demo akışını değiştirir |
| A3 | Dojang view fonksiyonlarında yasaklı opcode yok | #37 yazarının üretim beyanı; kaynak kod incelemesi | FR-19 bunu yakalar; tasarım değişir |
| A4 | STO-033 okumaları stake'li paymaster için izinli | ERC-7562 metni; #37 | Validation reddedilir |
| A5 | Ana cüzdanın attestation'ı 2026-10-22 21:23 UTC'ye kadar geçerli (`0xaa92…` ID) | Zincir okuması 2026-09-29 | E2E bu tarihten önce yapılmalı ya da yenilenmeli |
| A6 | eth-infinitism v0.8 `Simple7702Account` deterministik deploy ile kanonik adrese kurulabilir | Nick's factory GIWA'da mevcut (okundu) | Farklı adrese deploy; işlev etkilenmez |
| A7 | `debug_traceCall` struct logger GIWA RPC'de açık kalır | 2026-09-29 çağrısı başarılı | Opcode denetimi yalnız canlı gönderimle yapılır |

Harici bağımlılıklar (sürümler implementasyonda kayıt defterinden doğrulanıp sabitlenecek): eth-infinitism `account-abstraction` v0.8, `eas-contracts`, OpenZeppelin Contracts, viem (TS script'ler).

## Doğrulama kontrol listesi

- [x] Geçerlilik: her FR, #37'deki boşluğu kapatmaya veya bunu kanıtlamaya hizmet ediyor. FR-12/13/14 bütçenin bot tarafından boşaltılmasını önlüyor.
- [x] Tutarlılık: FR-13 "dönem" kavramı saat değil, owner sayacı (FR-17). Kapsam dışındaki zaman limitiyle çelişmiyor.
- [x] Tamlık: kütüphane, paymaster, araç, kanıt ve doküman kapsanıyor. Yayın/PR bilinçli olarak dışarıda.
- [~] Gerçekçilik: A1 ve A2 doğrulanmadan NFR-2 ve NFR-5 risk altında. Bu yüzden görevlerde ilk sırada.
- [x] Doğrulanabilirlik: her FR için test ya da script çıktısı tanımlı (tasks.md).
