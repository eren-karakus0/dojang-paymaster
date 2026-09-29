# Görevler — Dojang-gated ERC-4337 paymaster kiti

Tarih: 2026-09-29 · Tasarım: [design.md](design.md)

Sıralama riske göre yapıldı: A1 (stake eşiği) ve A2 (7702 desteği) yanlışsa tasarım değişir, bu yüzden önce onlar öğrenilir. Süre tahminleri Claude'un çalışma süresi aralığıdır. Dayanak: benzer büyüklükte Solidity ve script işi, bağımlılıkların Foundry ile uyumlu olması. Canlı ağ belirsizlikleri (bundler hataları) üst sınırı belirliyor.

| # | Görev | FR | Bağımlılık | Bitti koşulu | Tahmin |
|---|---|---|---|---|---|
| T1 | Repo iskeleti: Foundry projesi, bağımlılıkların kayıt defterinden doğrulanıp sabitlenmesi (account-abstraction v0.8, eas-contracts, OpenZeppelin), TS script paketi, `.gitignore`, ADR 0001 (araç seçimi), CI (Windows + Linux: `forge build/test`, tip kontrolü, sır taraması) | NFR-6, NFR-8 | — | Boş test paketi CI'da iki platformda yeşil | 0,5–1,5 sa |
| T2 | **Risk spike (canlı, düşük maliyet):** (a) `signer.ts` ve birim testi; (b) Simple7702Account v0.8'i deterministik deploy et; (c) yardımcı cüzdan oluştur, 7702 delegasyonunu **yardımcı cüzdanda** dene; (d) paymaster'ın minimal bir sürümüyle 0,001 ETH stake + deposit, bundler'a yardımcı cüzdandan op gönder ve ret mesajından stake eşiğini öğren | FR-21, FR-24, A1, A2, A6 | T1 | A1 ve A2 doğrulandı ya da çürütüldü; sonuç spec'e işlendi. Harcama ≤ 0,004 ETH | 1–3 sa |
| T3 | `DojangAddressVerifier` + mock Dojang kontratları + birim/fuzz testleri | FR-1…8 | T1 | FR-1…8 her biri en az bir testle geçiyor | 1,5–3 sa |
| T4 | `DojangVerifiedPaymaster` + EntryPoint v0.8 üzerinden birim testleri (validation, validUntil paketleme, limitler, postOp muhasebesi, epoch, owner yetkisi) + gas report | FR-9…18, NFR-3, NFR-4 | T3 | Testler geçiyor; gas hedefleri raporda | 2–4 sa |
| T5 | GIWA Sepolia fork testi: gerçek DojangScroll yapılandırmasıyla çözümleme. Doğrulanmış adres yalnız ortam değişkeninden gelir, yoksa test atlanır | FR-2, FR-5 | T3 | Env verilince geçer; commit'te kişisel adres yok | 0,5–1 sa |
| T6 | `opcode-audit.ts` | FR-19, NFR-1 | T4 | Deploy edilmiş paymaster için yasaklı opcode = 0 raporu | 1–2 sa |
| T7 | `deploy.ts` (tam sürüm) + Blockscout doğrulaması + `deployments/91342.json` | FR-20, FR-21, FR-25, NFR-5 | T2, T4 | Kontratlar Blockscout'ta doğrulanmış; toplam harcama kayıtlı | 1–2 sa |
| T8 | `e2e.ts`: ana cüzdanla 7702 + sponsorlu op (pozitif), yardımcı cüzdanla ret (negatif) | FR-22, FR-23, NFR-2 | T6, T7 | Pozitif op receipt `success`, negatif op bundler ret mesajı kaydedildi | 1,5–3 sa |
| T9 | Doküman: README (EN), `docs/pattern.md` (#37 problemi ve çözüm), `docs/rehber-tr.md`, "audit edilmedi" uyarısı | FR-26…28 | T8 | README adımları temiz klondan uygulanabilir | 1,5–2,5 sa |
| T10 | GitHub public repo, ilk sürüm etiketi (kullanıcı onayıyla) | — | T9 | CI yeşil, repo public | 0,5 sa |

**Toplam aralık:** yaklaşık 11–22 saat Claude çalışması. T2 başarısız olursa (7702 yok ya da stake eşiği yüksek) T8 yeniden tasarlanır; alternatif, sayaç-factory hesabı ve Dojang doğrulamasını hesabın sahibi EOA üzerinden yapmaktır. Bu, tahmine 2–4 saat ekler.

**Harcama tavanı:** tüm canlı adımlar için toplam 0,012 ETH (NFR-5). Her script tahmini maliyeti bu tavana karşı kontrol eder. Stake (0,001) ve deposit (≈0,005) sonradan geri çekilebilir: `unlockStake` sonrası 1 gün beklenir, ardından `withdrawStake` ve `withdrawTo`.
