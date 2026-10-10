# ごほうび学習

成人の学び直し向けの4択クイズを、恋愛シミュレーション風にしたアプリです。

- [`study-reward-app/`](study-reward-app/) — 本体（HTML/JS/CSS、`index.html` をブラウザで開けば動きます）と素材・生成ツール。詳細は [study-reward-app/README.md](study-reward-app/README.md)
- [`ios/`](ios/) — iOS 版（SwiftUI + WKWebView）。`xcodegen` で `project.yml` からプロジェクトを生成し、ビルド時に `study-reward-app/` の Web ファイルと `assets/` を同梱します
