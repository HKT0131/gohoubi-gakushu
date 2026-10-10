# 立ち絵・背景の作り方（画像生成AI編）

キャラクターの立ち絵と背景を画像生成AIで自作し、アプリに組み込むための手順書です。
上から順に進めれば終わるように書いています。

- 立ち絵: `assets/chara/stage{0-4}_{normal|happy|shy|sad|pout}.png`（全25枚。**最低5枚**、`stage0_normal`〜`stage4_normal` があれば動きます）
- 背景: `assets/bg/{room_morning,room_evening,room_night,library,cafe}.jpg`（5枚。無くても動きます）
- 検証: `node tools/check_assets.mjs`

アプリは画像を `stage{n}_{表情}.png` → `stage{n}_normal.png` → 内蔵SVGイラスト の順で探します。足りない画像があっても落ちません。少しずつ増やして構いません。

---

## 0. 内容の決まり（必ず守る）

| 決まり | 理由と具体策 |
|---|---|
| **成人女性に見えること** | 25歳の社会人。大人の顔立ち・体型・頭身（7〜7.5頭身）にする。制服っぽい服装（セーラー服、リボンタイ＋ブレザー＋短いプリーツ）に見えないよう、ブレザーは**オフィスカジュアル**、スカートは**膝丈〜ミディ丈**にする。ネガティブに幼さを示すタグを入れる。 |
| **最終段階は水着まで** | stage4 は**標準的なビキニ（可愛いデザイン）**。フリル・リボン・白のパイピング・ドット／ギンガム／小花柄などで可愛く見せる。**上限**: 布面積は一般的なビキニ（グラビア／ソシャゲの水着イベント立ち絵程度）まで。マイクロビキニ・スリング水着・透け素材・乳首や局部の描写は不可。胸や股の中央は布で連続して覆う。ポーズは他段階と同じ（性的に強調したポーズ不可）。それ以上の露出は作らない。 |
| **性的な強調をしない** | ポーズは全段階「まっすぐ立って腕を下ろす」で固定。胸・腰を強調する構図・タグ（cleavage, large breasts など）は使わず、ネガティブに入れる。 |
| **既存キャラ・実在人物に似せない** | 作品名・キャラ名・作家名・芸能人名をプロンプトに入れない。似ている画像の i2i や LoRA も使わない（著作権・肖像権・パブリシティ権）。 |
| **ストアの審査** | App Store 審査ガイドライン 1.1.4（あからさまに性的な内容の禁止）に触れない範囲に収める。年齢レーティングは適切に設定する。 [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) |

### 全プロンプト共通のネガティブ（コピペ用）

```
child, loli, shota, toddler, young child, teenager, aged down, petite body, small body, flat chest, chibi, large head, school uniform, serafuku, randoseru,
nsfw, nude, naked, nipples, covered nipples, cleavage, large breasts, huge breasts, lingerie, underwear, bra, panties, see-through, wet clothes, sexually suggestive, seductive pose, spread legs, from below, ass focus, breast focus,
bad anatomy, bad hands, extra fingers, missing fingers, extra arms, deformed, blurry, lowres, jpeg artifacts, watermark, signature, text, logo, cropped, out of frame
```

---

## 1. 全体の流れ（チェックリスト）

- [ ] **1. キャラ設定を固める**（下の「1-1 キャラシート」を埋める。色・髪型・服を英語タグで決め切る）
- [ ] **2. 基準の1枚 `stage0_normal` を作る**（全身・正面・腕を下ろす・無地の背景。何十枚か出して一番いいものを選ぶ。**seed と設定を記録**）
- [ ] **3. 同一性を保ったまま他の段階を作る**（基準画像から inpaint で服だけ描き替える → stage1 → 2 → 3 → 4。「2. 同一性を保つ方法」参照）
- [ ] **4. 表情を作る**（顔だけマスクして inpaint。stage1 で作った顔を stage2〜4 に貼り回すと楽）
- [ ] **5. 背景を除去して透過PNGにする**（「6. 背景除去」）
- [ ] **6. リサイズ・位置合わせ**（全部 1024x2048 の同じキャンバスに、同じ倍率・同じ位置で。「7. 位置合わせ」）
- [ ] **7. 背景5枚を作る**（「5. 背景プロンプト」→ 1170x2532 の JPEG に）
- [ ] **8. `assets/` に置く**（ファイル名は小文字・仕様どおり）
- [ ] **9. `node tools/check_assets.mjs` で検証**（エラー0件にする）
- [ ] **10. アプリで確認**（ブラウザで `index.html` を開く。iOS は Xcode で再ビルドすると `assets/` が自動で同梱されます）

作業フォルダの例（`work/` はアプリに入らないので、途中の画像はここに置く）:

```
study-reward-app/
  assets/chara/   ← 完成した透過PNGだけ
  assets/bg/      ← 完成したJPEGだけ
  work/           ← 生成元画像・マスク・メモ（seed、設定）
```

### 1-1. キャラシート（最初に決める）

全段階・全表情で**同じ文言をそのまま使い回す**のがコツです。下は記入例です（色は UI の「生成り・藍墨・朱」に合わせています）。

| 項目 | 記入例（英語タグ） | メモ |
|---|---|---|
| 人物 | `1girl, solo, adult woman, office lady, 25 years old, mature face, tall, slender, medium breasts, long legs` | 幼く見えたら `mature face` を強める。胸は「普通」に固定 |
| 髪 | `dark brown hair, medium hair, straight hair, side-swept bangs, tucked hair behind ear` | 帽子を外す stage1 で髪型が変わらないよう、**帽子の下も描かれる髪型**にする |
| 目 | `brown eyes, gentle eyes` | |
| 顔の特徴 | `small mole under eye`（任意） | 1つ特徴があると同一性の確認がしやすい |
| 靴 | `beige flat shoes` | **全段階で同じ靴**にする（足元を描き替えると位置がずれる）。脚は素足（タイツなし） |
| ポーズ | `standing, full body, straight-on, facing viewer, arms at sides, looking at viewer` | 腕は体の横。手を前で組むと服の描き替えが難しくなる |
| 画面 | `simple background, white background` | 背景除去しやすく。黒髪なら `grey background` も可 |
| 性格（基準の顔） | やさしい=`gentle smile` / ツンデレ=`closed mouth, slight frown` / クール=`expressionless, calm` / 元気=`smile, open mouth` | アプリ内で性格を変えても絵は1セット。迷ったら `light smile` で全性格に合わせる |

衣装（stage0 で全部着ている状態）:

| 衣装 | 記入例（英語タグ） | 脱ぐ段階 |
|---|---|---|
| ベレー帽 | `navy beret` | stage1 |
| マフラー | `vermilion scarf` | stage1 |
| トレンチコート | `beige trench coat, open coat, belted coat` | stage2 |
| ブレザー | `navy tailored blazer, business casual` | stage3 |
| ブラウス | `white blouse, collared blouse` | stage4 |
| プリーツスカート | `grey pleated skirt, knee-length skirt` | stage4 |
| 水着（最終） | `navy blue bikini, frilled bikini, white frills, white trim, halterneck, side-tie bikini bottom, white bow`（柄を足すなら `polka dot bikini` / `gingham bikini` / `floral print bikini`） | — |

---

## 2. 同一性を保つ方法（いちばん大事）

段階ごと・表情ごとに**ゼロから生成し直すと、顔・体型・位置が必ず変わります。** 基準の1枚から「描き替え」で派生させてください。

### 基本方針: inpaint で「服のレイヤーを1枚ずつ」描き替える

```
stage0_normal（基準）
  └ 頭とマフラーだけマスク → stage1_normal（帽子とマフラーなし）
      └ コートの部分だけマスク → stage2_normal（ブレザー姿）
          └ ブレザーの部分だけマスク → stage3_normal（ブラウスとスカート）
              └ 首から膝上までマスク → stage4_normal（水着）
各段階 normal の顔だけマスク → happy / shy / sad / pout
```

- **1つ前の段階を入力にする**（stage0 → stage1 → stage2 …）。毎回 stage0 から作るより差分が小さく、崩れにくい。
- **マスクは服の部分だけ**。顔・手・足・靴・髪（帽子を外すとき以外）はマスクしない。マスクの外は1ピクセルも変わらないので、位置と体型が保たれます。
- **プロンプトは毎回フルで書く**（キャラシートの人物・髪・目・靴・ポーズ＋その段階の服）。服のタグだけ差し替えます。
- **seed を固定**。うまくいかなければ seed だけ変えて何枚か出し、いいものを選ぶ。
- 服を「脱がせる（下の服を出す）」のは、服を「描く」より難しいので強さ（denoise / strength）を高め（0.7〜0.9）にします。体の輪郭がはみ出したら、マスクを体の線に沿って小さくする。
- うまく出ないときの裏技（**逆順方式**）: stage4（水着）を基準にして、その上に服を「着せる」方向で inpaint する。服を足すほうがAIは得意です。ただし stage0 の顔を基準にしたいので、最初に stage0 で顔と体型を決め、stage4 を作ってから stage3→2→1 を「着せる」で作り直す、という組み合わせも有効です。

### 表情: 顔だけマスクして inpaint

- マスクは眉〜あごまで（髪・耳・輪郭線は含めない）。強さは低め（0.35〜0.55）。
- 「マスク部分だけ高解像度で描く」設定（WebUI の `Only masked`、パディング 32〜64px）にすると顔が崩れにくい。
- **時短**: stage1〜4 は頭まわりが同じなので、**stage1 で4表情を作り、顔の部分だけ切り抜いて stage2〜4 に重ねる**だけで済みます（stage0 はマフラーと帽子があるので別に作る）。

```sh
# face_happy.png = stage1_happy から顔の部分だけ残した透過PNG（キャンバスは同じ 1024x2048）
magick assets/chara/stage2_normal.png work/face_happy.png -composite assets/chara/stage2_happy.png
```

### 補助テクニック（ツールにあれば併用）

| 手段 | 何に効くか | 使いどころ |
|---|---|---|
| 同じ seed・同じ構図・同じサイズ | 全体の雰囲気 | すべて |
| **ControlNet OpenPose** | ポーズと立ち位置を固定 | inpaint で崩れるとき、ゼロから描き直すとき |
| **ControlNet Reference / IP-Adapter** | 顔・服の色・画風を基準画像に寄せる | 表情差分、背景除去後の修正 |
| **キャラ LoRA を作る** | 顔の同一性を強力に固定 | 気に入った顔の画像が15〜30枚集まったら。手間は大きい |
| NovelAI **Character Reference**（V4.5 の Precise Reference） | 顔・服の同一性 | 基準画像を参照に入れて生成 |
| NovelAI **Vibe Transfer** | 画風・色味 | 背景の雰囲気を揃えるとき（Character Reference とは同時に使えない） |
| Midjourney/にじ `--cref`（niji 6）/ `--oref`（V7 の Omni Reference） | 顔・服の同一性（大まか） | inpaint が弱い MJ で使う。厳密な位置合わせはできない |

---

## 3. ツール別の手順・プロンプト

### 3-0. どれを使うか

| ツール | 同一性の保ちやすさ | 手軽さ | 費用 | おすすめ度 |
|---|---|---|---|---|
| **NovelAI（Diffusion V4.5）** | ◎ inpaint・Character Reference あり | ◎ ブラウザだけ | 月額（Opus なら一定サイズまで生成無料） | **一番おすすめ** |
| **Stable Diffusion（Forge / ComfyUI ＋ Illustrious系 / Animagine XL 4.0）** | ◎ inpaint・ControlNet・LoRA すべて使える | △ GPU とセットアップが必要（Mac は遅い） | 無料（電気代のみ） | 細かく詰めたい人向け |
| **にじジャーニー / Midjourney** | △ 位置を揃えるのが難しい | ○ | 月額 | 背景、キャラデザ案出し向け |

生成サイズの共通のおすすめ: **立ち絵 704x1408（ちょうど1:2）**。あとで 1024x2048 に拡大します。背景も 704x1408 で作って 1170x2532 に拡大・左右を少し切ります。

### 3-1. NovelAI（Diffusion V4.5 / V4 系）

**手順**

1. Image Generation → モデル `NAI Diffusion V4.5 Full`（無ければ V4 系）。
2. サイズを Custom で **704 x 1408**、Steps 28、Prompt Guidance 5〜6、Sampler `Euler Ancestral`、Noise Schedule `karras`。Undesired Content のプリセットは `Heavy`。
3. 下の stage0 プロンプトで何十枚か出し、基準を1枚選ぶ。**画像の右上メニューから seed をコピーして `work/memo.txt` に保存**。
4. 選んだ画像を「Edit Image（img2img）」で開き、**Inpaint** に切り替える。消したい服の部分を塗る → プロンプトを次の段階のものに差し替え → Strength 0.7〜0.9 で生成。
5. 顔が変わってしまうときは、Character Reference（Precise Reference）に stage0_normal を入れ、Fidelity を 0.6〜1.0 にする。
6. 仕上げに Upscale（またはツール外の拡大）で 2 倍にしてから、「7. 位置合わせ」で 1024x2048 に揃える。

**stage0_normal のプロンプト**（NovelAI は品質タグを自動で足すので書かなくてよい）

```
1girl, solo, adult woman, office lady, mature face, tall, slender, medium breasts, long legs,
dark brown hair, medium hair, straight hair, side-swept bangs, brown eyes, small mole under eye,
navy beret, vermilion scarf, beige trench coat, open coat, belted coat, navy tailored blazer, white blouse, collared blouse, grey pleated skirt, knee-length skirt, beige flat shoes,
light smile, closed mouth, looking at viewer,
standing, full body, straight-on, facing viewer, arms at sides,
simple background, white background
```

**Undesired Content**: 「0. 内容の決まり」の共通ネガティブをそのまま貼る。

V4 以降は「キャラクタープロンプト」欄が別にあります。使う場合は人物・髪・服・表情をキャラ欄に、`simple background, white background, full body` などをベースプロンプトに分けると、指示が混ざりにくくなります。

### 3-2. Stable Diffusion（WebUI Forge / ComfyUI）

**モデル**（SDXL 系のアニメモデル。ライセンスは「4. ライセンス」で必ず確認）

- **Illustrious XL** 系（`Illustrious-XL` 本体、またはそれをベースにしたマージ）
- **Animagine XL 4.0**

**推奨設定**

| 項目 | 値 |
|---|---|
| サイズ | 704 x 1408（または 768 x 1536） |
| Sampler | Euler a |
| Steps | 28 |
| CFG | 5〜6（Animagine XL 4.0 は 5 前後） |
| Hires. fix | 1.5倍、Denoise 0.35（全身でも顔が崩れにくくなる） |
| ADetailer | `face_yolov8n.pt`（顔の補正）。表情差分のときは**オフ**（せっかくの表情が戻る） |

**プロンプトの書き方**

- Illustrious 系: 先頭に `masterpiece, best quality, very aesthetic, absurdres,` を足す。
- Animagine XL 4.0: タグの順番を「人数 → キャラ説明 → 状況 → 品質」にし、末尾に `masterpiece, high score, great score, absurdres` を足す。
- 本文はキャラシートの英語タグをそのまま使う（NovelAI と同じ）。

**inpaint の手順（Forge）**

1. img2img → **Inpaint** タブに基準画像を入れ、消したい服を塗る。
2. Mask mode: `Inpaint masked` / Masked content: 服を脱がせるとき `latent noise`、表情は `original` / Inpaint area: 服は `Whole picture`、顔は `Only masked`（Padding 32px）。
3. Denoising: 服 0.75〜0.9、表情 0.35〜0.55。seed は基準と同じ値から始める。
4. **ControlNet を併用**（崩れるとき）
   - Unit 0: `OpenPose`（基準画像から抽出、Weight 1.0）… ポーズ固定
   - Unit 1: `IP-Adapter`（`ip-adapter-plus_sdxl_vit-h` など、Weight 0.5〜0.7）または Forge の `reference_only` … 顔・色を寄せる
   - SDXL 用の ControlNet モデルを使うこと（SD1.5 用は動きません）。
5. ComfyUI では「Load Image（マスク付き）→ VAE Encode (for Inpainting) → KSampler」に、`Apply ControlNet` と `IPAdapter` ノードを足す構成が定番です。

**キャラ LoRA（任意）**: 同じ顔の画像を15〜30枚（表情・服違い、背景は無地）集め、kohya_ss などで学習（SDXL、rank 16〜32、1500〜3000 step 程度）。トリガーワードは `misaki_oc` のように既存の名前と被らないものにする。

### 3-3. にじジャーニー / Midjourney

Midjourney は透過PNGが出せず、マスクの精度も低いので、**キャラデザの案出しと背景**向きです。立ち絵に使うなら次の流れにします。

1. `--niji`（にじジャーニーなら既定）、`--ar 1:2`、`--style raw`（作画のクセを抑える）で stage0 を作る。
2. 気に入った1枚の URL を控え、他の段階は `--cref <URL> --cw 100`（niji 6）や `--oref <URL>`（V7 系の Omni Reference）を付けて生成。表情は `--cw 0`〜`50` にすると顔だけ寄せて服は変えられる。※使えるパラメータはバージョンで違うので、[公式ドキュメント](https://docs.midjourney.com/)で確認。
3. Web エディタの「Vary (Region)」/「Editor」で服や顔の部分だけ描き直す。
4. 位置とサイズが揃わないことが多いので、「7. 位置合わせ」で手作業の調整が必要になります。

**プロンプト例（stage0）**

```
full-body character design of an adult Japanese office worker woman in her mid-twenties, mature face, tall slender figure, dark brown straight medium hair with side-swept bangs, brown eyes, navy beret, vermilion scarf, beige belted trench coat worn open over a navy tailored blazer, white collared blouse, knee-length grey pleated skirt, beige flat shoes, standing straight facing the viewer, arms relaxed at her sides, gentle light smile, plain white background, clean anime illustration --niji 6 --ar 1:2 --style raw --no child, school uniform, cleavage, text
```

（Midjourney は `--no` にネガティブを並べます。長すぎると効かないので重要なものだけ。）

---

## 4. ライセンス・商用利用（2026年10月時点の確認。必ず最新の規約を自分でも確認）

アプリを有料配信・広告付きにする場合は「商用利用」にあたります。

| ツール / モデル | 生成画像の権利・商用利用 | 注意点 | 出典 |
|---|---|---|---|
| **NovelAI** | 利用者が権利を保持（NovelAI は所有権を主張しない）。商用利用も可能だが、サービス外での利用は**自己責任**で、他者の権利を侵害しないことの確認は利用者側 | 規約（有効日 2025-12-08）の Content 条項 | [Terms of Service](https://novelai.net/terms) / [FAQ](https://docs.novelai.net/en/faq) |
| **Midjourney / にじジャーニー** | **有料プラン加入中に生成した画像**は利用者が所有し商用利用可（解約後も有効）。無料・非会員は CC BY-NC 4.0（商用不可） | **前年の総売上が年 100万USD 超の会社（の従業員）は Pro / Mega プランが必要**。生成画像は既定で公開ギャラリーに出る（非公開の Stealth は Pro / Mega）。他人の画像のアップスケールは元の作者のもの | [Terms of Service](https://docs.midjourney.com/docs/terms-of-service) / [にじジャーニー商用利用FAQ](https://nijijourney.com/help-center/general-commercial-use) |
| **Illustrious XL（early release v0）** | ライセンス `fair-ai-public-license-1.0-sd`。モデルカードに「生成物の利用・配布は制限しない」と明記。生成画像の商用利用は可 | **モデル自体**（ファインチューン・マージ・LoRA 等の派生物）をクローズドで収益化するのは禁止、派生物は公開が条件。Illustrious の後続バージョン（v1.0 以降）は配布元ごとに条件が違うので個別に確認 | [Hugging Face: Illustrious-xl-early-release-v0](https://huggingface.co/OnomaAIResearch/Illustrious-xl-early-release-v0) |
| **NoobAI-XL**（Illustrious 派生の人気モデル） | **生成物を含む商用利用を禁止する追加条項あり** | 商用アプリには**使わない**。NoobAI ベースのマージも同様に注意 | [Hugging Face: noobai-XL-Vpred-0.5 README](https://huggingface.co/Laxhar/noobai-XL-Vpred-0.5/blob/main/README.md) |
| **Animagine XL 4.0** | `CreativeML Open RAIL++-M`。商用利用可 | 用途制限（違法・有害な用途の禁止など）を守る。モデルを再配布するならライセンス同梱 | [Hugging Face: animagine-xl-4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0) |
| **Civitai などのマージモデル・LoRA** | モデルごとに違う | ページの許可アイコン（Sell generated images / Commercial use 等）を確認。**マージ元のうち一番厳しい条件が実質的に効く**と考える。不明なものは使わない | 各モデルのページ |

補足:

- 日本では、AIが自動生成しただけの画像は著作物と認められない可能性があります（人による創作的な寄与が必要）。他人にコピーされても権利主張しにくい点は理解しておく。 [文化庁「AIと著作権について」](https://www.bunka.go.jp/seisaku/chosakuken/aiandcopyright.html)
- 規約は頻繁に変わります。リリース前に上の出典をもう一度確認し、確認した日付をメモしておくと安心です。
- Midjourney の規約ページは自動取得できなかったため、表の内容は公式ヘルプの検索結果と解説記事（[terms.law](https://terms.law/ai-output-rights/midjourney/)）で確認したものです。

---

## 5. プロンプト差分の表

使い方: **キャラシートの共通部分（人物・髪・目・靴・ポーズ・画面）＋ 段階の服タグ ＋ 表情タグ** をつなげる。inpaint のときはマスクした部分に関係するタグを特に正確に。

### 5-1. 段階ごと（服の差分）

| 段階 | ファイル | 服のタグ（共通部分に足す） | ネガティブに足す | inpaint のマスク範囲（入力 → 出力） |
|---|---|---|---|---|
| stage0 | `stage0_*.png` | `navy beret, vermilion scarf, beige trench coat, open coat, belted coat, navy tailored blazer, white blouse, collared blouse, grey pleated skirt, knee-length skirt` | — | （基準。ゼロから生成） |
| stage1 | `stage1_*.png` | `no headwear, beige trench coat, open coat, belted coat, navy tailored blazer, white blouse, collared blouse, grey pleated skirt, knee-length skirt` | `hat, beret, scarf` | stage0 → 帽子と頭頂の髪、マフラーと首まわり |
| stage2 | `stage2_*.png` | `navy tailored blazer, white blouse, collared blouse, grey pleated skirt, knee-length skirt` | `coat, trench coat, scarf, hat` | stage1 → コート全体（袖・裾を含む。手は除く） |
| stage3 | `stage3_*.png` | `white blouse, collared blouse, long sleeves, grey pleated skirt, knee-length skirt` | `blazer, jacket, coat, scarf, hat` | stage2 → ブレザー全体（袖を含む） |
| stage4 | `stage4_*.png` | `navy blue bikini, frilled bikini, white frills, white trim, halterneck, side-tie bikini bottom, white bow, bare arms, bare legs, bare shoulders, navel` | `nude, nipples, areola, see-through, micro bikini, sling bikini, thong, highleg, underboob, sideboob, nsfw, cleavage, blouse, skirt, one-piece swimsuit` | stage3 → 首元から膝上まで（顔・膝下・靴は除く）。腕と手も描き直すので、ControlNet OpenPose で腕の位置を他段階に揃える |

### 5-2. 表情ごと

| 表情 | ファイル末尾 | 表情タグ | ネガティブに足す | メモ |
|---|---|---|---|---|
| normal | `_normal` | `light smile, closed mouth` | — | 性格に合わせて変えてよい（キャラシート参照） |
| happy | `_happy` | `smile, open mouth, happy, bright eyes` | `crying, frown` | 合格・正解時 |
| shy | `_shy` | `blush, embarrassed, shy, light smile, looking away` | `open mouth, laughing` | 照れ。顔の向きは変えず目線だけ |
| sad | `_sad` | `sad, frown, downturned eyes, worried` | `smile, tears` | 不合格時。泣き顔まではしない |
| pout | `_pout` | `pout, :t, annoyed, slight blush` | `smile, open mouth` | ツンデレの拗ね |

### 5-3. 25枚の組み合わせ（S=段階の服タグ、E=表情タグ）

| | normal | happy | shy | sad | pout |
|---|---|---|---|---|---|
| **stage0** | S0 + E_normal（**基準**） | S0 + E_happy | S0 + E_shy | S0 + E_sad | S0 + E_pout |
| **stage1** | S1 + E_normal | S1 + E_happy（**顔パーツ作成**） | S1 + E_shy（同左） | S1 + E_sad（同左） | S1 + E_pout（同左） |
| **stage2** | S2 + E_normal | stage1 の顔を合成 | stage1 の顔を合成 | stage1 の顔を合成 | stage1 の顔を合成 |
| **stage3** | S3 + E_normal | stage1 の顔を合成 | stage1 の顔を合成 | stage1 の顔を合成 | stage1 の顔を合成 |
| **stage4** | S4 + E_normal | stage1 の顔を合成 | stage1 の顔を合成 | stage1 の顔を合成 | stage1 の顔を合成 |

- 顔の合成で境目が目立つときは、合成後に顔の輪郭だけ低い強さ（0.25〜0.35）で inpaint するとなじみます。
- 表情差分でも、体や腕は変えない（照れて胸を隠す、などのポーズ変更はしない）。

---

## 6. 背景プロンプト（5種）

共通の条件: **人物なし**、縦長、ややぼかし気味でよい（キャラが前に立つので）、色は「生成り・藍墨・朱」に寄せる。

**共通ポジティブ（末尾に足す）**

```
no humans, scenery, indoors, vertical composition, eye level, soft focus, depth of field, anime background art, warm off-white and indigo color palette, subtle vermilion accents
```

**共通ネガティブ**

```
1girl, 1boy, people, person, character, text, watermark, signature, logo, lowres, blurry foreground objects, distorted perspective, fisheye
```

| ファイル | プロンプト（共通部分の前に置く） |
|---|---|
| `room_morning.jpg` | `small one-room apartment of a working adult in Japan, tidy, wooden desk with laptop and notebooks, bookshelf with business books, potted plant, coffee mug, white curtains, bright morning sunlight through window, light blue sky, fresh atmosphere` |
| `room_evening.jpg` | `same small one-room apartment of a working adult, wooden desk with laptop and notebooks, bookshelf, potted plant, desk lamp, orange sunset light through window, long warm shadows, calm evening` |
| `room_night.jpg` | `same small one-room apartment of a working adult at night, desk lamp on, warm lamp light, laptop screen glow, dark blue night sky and city lights outside window, curtains half open, quiet cozy atmosphere` |
| `library.jpg` | `quiet public library study area, long wooden study tables, tall bookshelves, reading lamps, large windows, late afternoon light, calm and studious atmosphere` |
| `cafe.jpg` | `cozy cafe interior, wooden counter and small tables, coffee cups, pendant lights, plants, large window with street view, soft afternoon light, relaxed atmosphere` |

- 部屋の3枚は**同じ部屋**に見えることが大事です。朝を先に作り、それを img2img（強さ 0.4〜0.55）やNovelAI の Vibe Transfer に入れて夕方・夜を作ると揃います。
- 大人の部屋らしさ: 学習机・ランドセル・ぬいぐるみの山などは避け、ノートPC・ビジネス書・観葉植物・マグカップなどを置く。
- Midjourney なら末尾に `--ar 6:13 --niji 6`（6:13 ≒ 1170:2532）。

**書き出し（1170x2532 の JPEG に）**

```sh
# macOS 標準の sips（高さを 2532 にしてから中央を 1170 幅で切り出し、品質 85 の JPEG に）
sips --resampleHeight 2532 work/bg_room_morning.png --out work/tmp.png
sips -c 2532 1170 work/tmp.png --out work/tmp.png
sips -s format jpeg -s formatOptions 85 work/tmp.png --out assets/bg/room_morning.jpg

# ImageMagick の場合（brew install imagemagick）
magick work/bg_room_morning.png -resize 1170x2532^ -gravity center -extent 1170x2532 -quality 85 assets/bg/room_morning.jpg
```

---

## 7. 背景除去（透過PNGにする）

無地の背景で生成しておくと、どの方法でもきれいに抜けます。

| 方法 | 手順 | 向き・不向き |
|---|---|---|
| **macOS Finder** | 画像を右クリック → クイックアクション → **背景を除去** | 一番手軽。複数枚まとめて可能 |
| **macOS プレビュー / 写真** | 画像を開く → 人物を長押し（または「編集」→「被写体を持ち上げる」）→ コピー → プレビューの「ファイル > クリップボードから新規作成」→ PNG で保存 | 手軽。ただし手作業 |
| **rembg**（無料・コマンド） | `pip install "rembg[cli]"` → `rembg i -m isnet-anime work/in.png work/out.png`（アニメ絵用モデル）。フチがガタつくときは `-a`（alpha matting）を付ける | 25枚まとめて処理: `rembg p -m isnet-anime work/raw work/cut` |
| **Photoshop** | 「選択とマスク」または「背景を削除」 → 髪は「境界線調整ブラシ」でなぞる | 一番きれい。有料 |
| **NovelAI / Forge の Remove Background 機能** | 生成画面のツールから実行 | 生成と同じ場所で完結 |

**髪の毛先・フチの処理**

- **白いフチ（ハロー）が出たら**:
  - Photoshop: レイヤー → マッティング → **白マット削除**（またはフリンジ削除 1px）。
  - ImageMagick でアルファを 1px 内側に削る:
    ```sh
    magick in.png \( +clone -alpha extract -morphology Erode Disk:1 \) -alpha off -compose CopyOpacity -composite out.png
    ```
- 黒髪・濃い髪は白背景だとフチが白くなりやすいので、**灰色背景（`grey background`）で生成**するのも有効。
- 細い毛先は無理に残さず、少し丸めてよい（スマホ表示では目立ちません）。
- **全段階で同じ方法・同じ設定で抜く**（段階で輪郭の太さが変わると差し替えがチラつく）。

---

## 8. 位置合わせ（全画像を同じキャンバスに揃える）

目標: **1024x2048 の透明キャンバス、足元が下端から約3%（約60px）、頭頂が上端から約5%（約100px）、左右中央**。全段階で同じ位置・同じ大きさ。

### 8-1. inpaint で作った場合（おすすめ）

全画像が最初から同じサイズ・同じ位置なので、**全部に同じコマンドを当てるだけ**です。

```sh
# 704x1408 で生成 → 背景除去した PNG を work/cut/ に置いた場合
mkdir -p assets/chara
for f in work/cut/stage*.png; do
  magick "$f" -filter Lanczos -resize 1024x2048 -background none -gravity center -extent 1024x2048 "assets/chara/$(basename "$f")"
done
node tools/check_assets.mjs   # 頭頂/足元/中心X の値を確認
```

人物が小さい・下に寄っているなど、全体を動かしたいときは**全画像に同じ数値で**調整します（stage0_normal の数値を見て決める）。

```sh
# 例: 人物を 1.06 倍にして、下端を 61px 上げた位置に置く（数値は全ファイル共通）
for f in work/cut/stage*.png; do
  magick -size 1024x2048 xc:none \( "$f" -filter Lanczos -resize 1024x2048 -resize 106% \) \
    -gravity south -geometry +0+61 -composite "assets/chara/$(basename "$f")"
done
```

※ `-gravity south -geometry +0+61` は「画像の下端」を基準にします。生成画像の足元の下に余白がある場合は、その分だけ数値を減らしてください。`check_assets` の「足元」が 3% 前後になれば OK。

macOS 標準の `sips` でもサイズ変更はできます（透過は保たれます）。比率が 1:2 の画像なら:

```sh
sips -z 2048 1024 work/cut/stage0_normal.png --out assets/chara/stage0_normal.png
```

### 8-2. 別々に生成した場合（Midjourney など）

1. 画像編集アプリ（Photopea［無料・ブラウザ］、Photoshop、Pixelmator など）で 1024x2048 の透明キャンバスを作る。
2. **stage0_normal を基準レイヤー**として置き、足元・頭頂・中心を合わせる。ガイド線を 102px（5%）と 1987px（下から3%）に引く。
3. 他の画像を上のレイヤーに重ね、不透明度 50% にして**目・肩・足の位置が重なるように**拡大縮小・移動する。
4. 不透明度を 100% に戻し、そのレイヤーだけ書き出す。全ファイル繰り返す。
5. `check_assets` で「段階間の揃い」に警告が出ないことを確認。

### 8-3. 容量を軽くする（任意）

```sh
brew install pngquant
pngquant --quality 80-95 --skip-if-larger --ext .png --force assets/chara/*.png
```

1枚 2MB 以下が目安です（25枚 + 背景5枚で合計 40MB 以下）。

---

## 9. 検証とアプリでの確認

```sh
cd study-reward-app
node tools/check_assets.mjs          # 表で結果を表示（空でもエラーにならない）
node tools/check_assets.mjs --strict # エラーや必須不足があれば終了コード 1
```

確認する内容:

- ファイル名が仕様どおりか（小文字、`.png` / `.jpg`、打ち間違い）
- 画像のサイズと縦横比（立ち絵 1:2、背景 約 0.462）、中身と拡張子が一致しているか
- 立ち絵に透過があるか、背景が残っていないか、フチが白っぽくないか（目安）
- 人物の位置（頭頂・足元・左右中心）と、全段階のキャンバスサイズ・位置が揃っているか
- 必須5枚・推奨25枚・背景5枚の不足
- 1枚 2MB 超の警告と合計容量

アプリでの確認:

- ブラウザ: `index.html` を開き、設定で 2D 表示にしてクイズを進め、各段階で人物が「動かずに服だけ変わる」ことを見る。
- iOS: Xcode で `ios/StudyReward.xcodeproj` を開いて再ビルド（ビルド時に `study-reward-app/assets/` がアプリに同梱されます）。

---

## 10. よくある失敗と対策

| 症状 | 原因 | 対策 |
|---|---|---|
| **段階ごとに顔が変わる** | 毎回ゼロから生成している / マスクに顔が入っている | 1つ前の段階から inpaint。マスクから顔を外す。Character Reference / IP-Adapter を併用。最終手段はキャラ LoRA |
| **服の色が変わる**（紺が黒に、など） | 色タグが段階ごとに違う / 強さが高すぎる | キャラシートの文言をコピペで統一。残す服はマスクしない。色ずれは編集アプリの「色相・彩度」で手直し |
| **手が崩れる** | 全身絵は手が小さく崩れやすい | 腕は体の横で固定。手はマスクに入れない。崩れた手だけ別に inpaint（`Only masked`、強さ 0.4〜0.5）。袖で手首を隠す |
| **段階で体型が変わる**（細く・太く・胸が大きく） | 服を脱がせる inpaint で体の線まで描き直されている | マスクを体の線より少し内側に。プロンプトに `slender, medium breasts` を毎回入れ、`large breasts` をネガティブに。OpenPose を併用 |
| **幼く見える** | アニメモデルの傾向 / 顔が大きい | `adult woman, mature face, tall` を強め（`(mature face:1.2)` など）、ネガティブに `child, loli, large head, chibi`。頭身を 7 頭身以上に |
| **制服っぽく見える** | ブレザー＋プリーツスカートの組み合わせ | `business casual, office lady` を足し、スカート丈を膝下に。ネガティブに `school uniform` |
| **位置・大きさがずれる** | 別々に生成した / トリミングを個別にした | inpaint で作ってから全画像に同じコマンドで揃える（8章）。`check_assets` の数値で確認 |
| **透過のフチが白い・黒い** | 背景色が髪に混ざっている | 白マット削除 / アルファを 1px 削る（7章）。濃い髪は灰色背景で生成 |
| **背景が完全に抜けていない** | 背景除去の取りこぼし | `check_assets` が「透明な画素がほぼない」と出す。別の方法で抜き直す |
| **水着の段階で露出が増える** | モデルの傾向 | ネガティブに `micro bikini, sling bikini, see-through, nipples, areola, underboob, sideboob, highleg, thong, nsfw` を必ず入れる。上限（0章）を超えたものは使わない |
| **Midjourney で水着が生成できない** | モデレーションで弾かれる | 立ち絵は NovelAI / SD で作り、MJ は背景だけに使う |

---

## 11. 素材ができたら

`assets/chara/` と `assets/bg/` にファイルを置いたら、Claude に

> アセットを入れたので確認して

と伝えてください。`node tools/check_assets.mjs` の実行と指摘の説明、問題がなければ iOS アプリの再ビルドまで行います。
