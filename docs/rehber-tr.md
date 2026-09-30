# Kısa rehber (Türkçe)

## Bu repo ne?

GIWA'da bir uygulamanın, yalnız **Dojang ile doğrulanmış** (Upbit KYC'li) kullanıcıların işlem ücretini (gas) ödemesini sağlayan örnek bir paymaster kontratı ve onun kullandığı doğrulama kütüphanesi.

## Hangi sorunu çözüyor?

Dojang'ın hazır `isVerified` fonksiyonu sürenin dolup dolmadığını kontrol etmek için zincirin saatini okuyor. ERC-4337 kuralları, gas sponsorluğu kontrolü sırasında saati okumayı yasaklıyor. Bu yüzden `isVerified` kullanan bir paymaster'ı GIWA'nın bundler'ı reddediyor ([giwa-io/dojang#37](https://github.com/giwa-io/dojang/issues/37)).

Buradaki kütüphane aynı doğrulamayı saati okumadan yapıyor. Attestation'ın bitiş zamanını EntryPoint'e iletiyor ve süre kontrolünü o yapıyor.

## Durum

- Kontratlar yazıldı, 36 test geçiyor, GIWA Sepolia'ya deploy edildi.
- Doğrulama adımında yasaklı işlem olmadığı zincir üzerinde izlenerek gösterildi (`docs/evidence/opcode-audit.json`).
- **Canlı demo tamamlanmadı.** GIWA bundler'ı bu tür bir paymaster için 1 ETH teminat (stake) istiyor; mevcut stake 0,001 ETH.
- Kod audit edilmedi. Yalnız testnet içindir.

## Çalıştırma

```bash
git clone --recurse-submodules https://github.com/eren-karakus0/dojang-paymaster
cd dojang-paymaster
forge test
```

Ayrıntılar için İngilizce [README](../README.md) ve [pattern.md](pattern.md) belgelerine bakın.
