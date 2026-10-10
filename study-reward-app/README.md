# ごほうび学習

成人の学び直し向けの4択クイズを、**「学ぶほど仲良くなる」恋愛シミュレーション**にしたアプリです。
キャラクター（成人女性・デフォルト25歳の社会人）と「勉強デート」（クイズ）をして、好感度・経験値・コインを集めます。好感度が上がると会話イベントが解放され、合格を重ねると衣装の段階が進みます。

衣装の段階: ベレー帽とマフラー → コート → ブレザー → ブラウスとスカート → **水着（最終段階。3D 表示ではビキニ）**

## 起動方法

ビルドもサーバーも要りません。`index.html` をブラウザで開けば動きます（`file://` で動作します）。

- iOS アプリ版（SwiftUI + WKWebView、`../ios`）は、このフォルダの html/js/css と `assets/` をそのままバンドルします。
- 動作確認用に、URL に `?time=morning|evening|night` を付けるとホームの時間帯を固定できます。

## ゲームの仕組み

| 要素 | 内容 |
|---|---|
| ホーム | キャラの部屋。端末の時刻で背景が朝（5–15時）・夕（15–19時）・夜に変わる。キャラをタップすると話しかけられる（1日5回、好感度+1、好感度帯でセリフが変わる）。上部に好感度ハート／レベル、コイン、学習Lv、連続学習日数。下部メニュー: おはなし・アルバム・勉強する・ミッション・設定 |
| 勉強デート | 既存のクイズ。STAGE カットイン、コンボ、残り10秒の緊張演出（BGM が `study_hurry` に）、よそ見検知。正解でキャラが跳ね、不正解でしょんぼり沈む |
| 結果 | ランク（S/A/B/C）の段階表示、ごほうび（好感度・経験値・コイン）、間違えた問題は1問ずつめくる復習カード。合格で衣装段階が進むときは、立ち絵のクロスフェード＋やわらかい光の演出 |
| 好感度レベル | 知り合い → 顔なじみ → 友達 → 仲良し → 特別な人 → 大切なパートナー（`app.js` の `LEVELS`）。レベルアップでフルスクリーン演出と、解放された会話イベントの案内 |
| 会話イベント | ビジュアルノベル形式（背景＋立ち絵＋テキストウィンドウ、選択肢で好感度が変化、AUTO／SKIP）。8本。好感度レベルか連続学習日数で解放。初回視聴でコイン+20 |
| デイリー | ログインボーナス（7日カレンダー）、デイリーミッション3つ（1回合格・10問正解・5問連続正解）＋全達成ボーナス |
| コイン | プレゼント（5種、1日3回まで、好感度アップ）と、アルバムの表情差分の解放に使う。課金なし |
| アルバム | 見た会話イベントの再生、立ち絵ギャラリー（到達した衣装段階のみ。ふつう顔は無料、他の表情はコインで解放） |
| 設定 | 学習／キャラ／サウンド（BGM・音声・効果音の音量と ON/OFF、振動）／その他（クレジット、衣装リセット、データ消去） |

ごほうびの量（`finishRound`）: 好感度 = 合格15（不合格4）＋正解数＋ランクS8/A4＋5連続3、経験値 = 正解×10＋合格30、コイン = 正解×2＋合格20＋ランクS20/A10。

### 画面の方針

- **すべての画面は1画面に収まる固定レイアウト**です。ページの縦スクロールは出しません（`html, body { overflow: hidden }`、`overscroll-behavior: none`、`touchmove` 抑止）。
- 画面の切り替えは暗転・ワイプ・シートのスライドで行います。収まらない情報はタブ・ページ送り（◀ 1/3 ▶）・めくりカード・ダイアログに分けます。
- iPhone SE（375×667）でも収まることを確認しています。

## ファイル構成と担当

| ファイル | 内容 | 担当 |
|---|---|---|
| `index.html` | 画面の骨組み（シーン・ホーム・勉強・結果・会話イベント・シート・演出レイヤー） | アプリ実装 |
| `style.css` | 見た目。CSS で描いた背景（部屋・図書館・カフェ）、立ち絵の動き、各画面のレイアウト | アプリ実装 |
| `app.js` | アプリ本体（進行、好感度・コイン・デイリー、会話イベントの再生、アルバム、設定、保存とマイグレーション） | アプリ実装 |
| `script.js` | **キャラのセリフと会話イベントの台本をすべて集約**（`SCRIPT`） | アプリ実装 |
| `fx.js` | 演出（タイプライター、カットイン、コンボ、フラッシュ／シェイク、ランク表示、暗転・ワイプ、ハート、光、振動） | アプリ実装 |
| `sfx.js` | 効果音（WebAudio 合成） | アプリ実装 |
| `questions.js` | 問題バンク、`SUBJECTS`、`buildQuestions()` | 問題担当 |
| `character.js` | SVG の立ち絵（画像が無いときの代替表示）: `renderCharacter` / `LAYERS` / `MAX_STAGE` | 既存（基本触らない） |
| `bgm.js` | BGM（`GameBGM`） | BGM 担当 |
| `voice.js`, `assets/voice/` | キャラボイス（`GameVoice`）、音声ファイルと `manifest.js` | 音声担当 |
| `ASSETS.md`, `tools/check_assets.mjs` | 立ち絵・背景画像の仕様と検証 | アセット仕様担当 |
| `character_vrm.js`, `assets/vrm/`, `assets/lib/` | 3D 表示（VRM）。`CharacterVRM` | 3D キャラ担当 |
| `tools/vrm/` | VRM の加工（`build_vrm.mjs`）とライブラリのバンドル（`build_lib.mjs`）。アプリには同梱しない | 3D キャラ担当 |

### 3D 表示（キャラ表示: 2D / 3D）

設定 → キャラ → 「キャラ表示」で 3D を選ぶと、立ち絵の位置（ホーム・勉強・結果・会話イベント・衣装チェンジ）に動く 3D モデルを表示します。保存先は localStorage `charaView`（`"2d"` / `"3d"`、既定は 2D）。

- モデル: `assets/vrm/chara.vrm`（VRoid 公式 β Ver AvatarSample_4、**CC0**。VRM meta も商用・改変・再配布・性的表現すべて許可、クレジット不要。出典と改変内容は `assets/vrm/LICENSE.txt`）。クレジット画面にも記載。
- ライブラリ: `assets/lib/three-vrm.iife.js`（three.js r169 + @pixiv/three-vrm 3.5.5 を esbuild で IIFE 化、`window.VRMLib`）。3D を選んだときだけ読み込みます。
- `CharacterVRM.mount(container, { colors })` → `view = { ready, setStage(stage, { animate }), setExpr(expr), react(kind), setColors(chara), dispose() }`。`app.js` は `drawStand` / `setExpr` / `react` から同じタイミングで呼びます（hop → correct、droop → wrong、合格で pass、よそ見で away）。
- 3D の衣装段階はモデル本来の服を順に外します: 全部（＋ベレー帽とマフラー）→ 袖 → ブラウス（ビキニのトップ＋スカート）→ スカート → **ビキニ（最終段階、素足）**。3D 表示中は「次の合格で」・カットイン・アルバムの段階名を `CharacterVRM.LAYERS` / `OUTFITS` に切り替えます（2D の表示は従来どおり）。段階のボイス（コート／ブレザーと言うセリフ）は 2D 基準のままです。
- ベレー帽・マフラーは実行時に three.js で追加し、髪と襟の形を測って頭・首に沿わせます（色はキャラ設定のベレー帽／アクセント色）。外れるときはフェード＋光の粒。
- 水着の色はキャラ設定の「水着」色を使います（焼き込み時のマスクの範囲だけ色を置き換え）。肌と紛れないよう、明るい無彩色は濃いチャコールに、暖色（赤〜黄）は濃く鮮やかに補正し、それでも肌に近い場合は既定のピンクにします。
- **ビキニは体テクスチャに焼き込み済み**で、元の体テクスチャは同梱していません。どの段階・途中状態でも素肌の体は描画されません。形は 2D の stage4 に合わせた三角ビキニ（三角カップ＋首掛けストラップ＋細いアンダーバンド、ボトムは鼠径部に沿ったレッグカットで太ももに掛けない）。柄は水玉＋濃い色のパイピング（体テクスチャ、地色はキャラ設定の水着色）、アンダーバンド中央と腰の両サイドに白いリボン（three.js のメッシュ、体の表面を測って沿わせる）。体テクスチャには白を使いません（体の影色が肌用の暖色のため、白は影で肌色に見える）。
- 検査は2段階で、どちらかに失敗すると `assets/vrm/chara.vrm` は更新されません。
  1. `build_vrm.mjs`（テクスチャ上）: 覆うべき範囲の三角形がすべて水着色か（JPEG 後も）、胸の頂点・股・お尻・お尻の割れ目の基準点が縁から 2cm 以上内側か（胸の頂点の周り半径 1cm は 1.2cm 以上）、水着の塗り広げが手など他の部位に掛かっていないか。結果は `tools/vrm/out/chara.candidate.vrm`。
  2. `verify_render.mjs`（実レンダリング）: 候補を headless Chrome で正面・斜め・背面・下方・遠目（ミップマップが効く距離）から描画し、三角カップ（左右）・ボトム中央（前・後ろ）・股下の矩形に肌色ピクセルが 0 個であること（お腹の矩形は肌色＝判定の対照）。stage 3・4、水着色は既定と複数の設定色（肌に近い色を含む）。合格したら `assets/vrm/chara.vrm` にコピー。
- アイドル: 呼吸、まばたき、視線追従（ポインタ／ランダム）、首の揺れ、髪・スカート・袖の揺れもの（胸の揺れものは削除）。ピクセル比は最大 2。背景は透過。
- WebGL が使えない、またはモデル／ライブラリを読み込めないときは 2D に戻してトーストで知らせます。モデルは XHR で読むため、PC のブラウザで `file://` を直接開くと読み込めません（iOS 版は `allowFileAccessFromFileURLs` で読めます。PC で確認するときは簡易サーバーか Chrome の `--allow-file-access-from-files`）。
- 肌の色合わせ: 元の体テクスチャは胴・腕が顔や首より白く、首の付け根（鎖骨の上）に明るさの段差があります（服で隠れていた部分）。`build_vrm.mjs` が UV の島ごとに肌色を顔（あご下）の色へ合わせ、首の付け根は細かく合わせ直します。実レンダリングでの色差は `tools/vrm/measure_skin.mjs` で測れます（鎖骨・胸元・首の付け根とあご下の ΔE は 1〜2）。
- 作り直し: `cd tools/vrm && npm i && node build_lib.mjs && node build_vrm.mjs && node verify_render.mjs`（verify_render が通ったときだけモデルが差し替わる）。
- 容量の目安: `chara.vrm` 約 11.2MB、`three-vrm.iife.js` 約 0.7MB（合計 約 12MB）。

### モジュール間の契約

- `script.js` → `SCRIPT = { lines, episodes, personalities, line(p, category), resolve(p, id) }`
  - `lines["<personality>.<category>.<n>"] = { text, expr }`。personality は `gentle` / `tsundere` / `cool` / `genki`、expr は `normal` / `happy` / `shy` / `sad` / `pout`。**lineId は音声ファイル名になるので、番号を詰めたり並べ替えたりしない**（追加は末尾の番号で）。
  - セリフには `{name}` などの置換を入れません（音声は固定文で生成するため）。プレイヤーへの呼びかけは「あなた／あんた／きみ」。
  - `episodes[] = { id, title, summary, unlock: { level?, streak? }, bg, outfit, steps }`。steps は `{ lineId: "*.ep01.3" }`（`*` は実行時に性格名へ置換）、`{ narration }`（音声なし、`{name}` はキャラ名に置換）、`{ choice: [{ text, aff, reply }] }`。
  - 主なカテゴリ: `greet_morning/evening/night`、`talk0/1/2`（好感度帯）、`talklimit`、`start`、`correct`、`wrong`、`combo`、`hurry`、`away`、`timeup`、`stage1`〜`stage4`（衣装が進むとき）、`pass`、`fail`、`complete`、`perfect`、`levelup1`〜`levelup5`、`gift`（1〜5 は `GIFTS` の順）、`login`、`mission`、`ep01`〜`ep08`。
  - lineId の一覧を出すには: `node -e "eval(require('fs').readFileSync('script.js','utf8')+';console.log(Object.keys(SCRIPT.lines).join(\"\\n\"))')"`
  - セリフを表示するとき、`app.js` は必ず `GameVoice.has(id) && GameVoice.play(id)` を呼び、テキストのタイプライター表示と同時に再生します。
- `bgm.js` → `GameBGM.play(track)`。track は `title`/ `home` / `study` / `study_hurry`（残り10秒）/ `result_win` / `result_lose` / `event`（会話イベント・レベルアップ）。最初のユーザー操作で `unlock()`。
- `voice.js` → `GameVoice`。BGM のダッキングは voice.js が行います。クレジットは `GameVoice.credits`（無ければ `assets/voice/manifest.json` の `"credits"`）を設定 → その他 → クレジットに表示します。
- 音量・ON/OFF は各モジュールと同じ localStorage キー（`bgmVol`/`bgmOn`、`voiceVol`/`voiceOn`、`fxSoundVol`/`fxSound`、振動は `fxHaptic`）を使います。
- 画像: `assets/chara/stage{n}_{expr}.png` → `stage{n}_normal.png` → SVG の順に使います（起動時に読み込んでキャッシュ）。背景は `assets/bg/<name>.jpg`、無ければ CSS で描いた背景。詳しくは `ASSETS.md`。
- `questions.js` → `SUBJECTS = [{ id, label }]`、`buildQuestions(subjectId, count, customText)` → `[{ q, a, choices }]`。
- `app.js` は IIFE で囲んであり、グローバルには何も公開しません。
- iOS 側から `window.dispatchEvent(new Event("appbackground"))` を送ると「よそ見」として扱います。振動は `window.webkit.messageHandlers.haptic.postMessage("success" | "error" | "light")`。

## カスタマイズ

- 初期値: `app.js` の `DEFAULTS`
- 好感度レベル・プレゼント・ログボ・ミッション・アルバムの価格: `app.js` 冒頭の `LEVELS` / `GIFTS` / `LOGIN_REWARDS` / `MISSIONS` / `ALBUM_PRICE`
- セリフと会話イベント: `script.js`
- ポモドーロ: `app.js` の `POMODORO_ROUNDS`（既定4ラウンド）と `SESSION_GAP_MS`（既定15分）
- 問題: `questions.js`

## 自作問題のフォーマット

「勉強する」で科目を「自作問題」にするか、設定 → 学習 → 自作問題を編集 から入力します。1行に1問です。

```
問題,正解,誤答1,誤答2,誤答3
```

- 区切りは半角カンマ・全角カンマ・タブのどれでも構いません。誤答は省略できます（他の問題の正解から補います）。4問以上必要です。

## 保存データ（localStorage）

`study`（学習設定）, `chara`（キャラ設定）, `charaView`（2D/3D 表示）, `progress`（衣装段階・通算成績・復習）, `daily`（日別記録・60日）, `session`（連続ラウンド）, `game`（好感度・経験値・コイン・既読イベント・アルバム・ログボ・ミッション・連続学習日数）

- `game` が無い旧データは、起動時に `progress` から引き継ぎます（合格数・正解数から好感度・経験値・コインを換算。レベルアップ演出が連続しないよう、その時点のレベルは見たことにします）。旧 `study.view`（2D/3D）は削除します。

## 内容の方針

- 成人の学び直しを対象としたアプリです。個人利用を前提としており、App Store での配布は予定していません。
- キャラクターは成人女性です（既定25歳・社会人、設定できる年齢は20歳以上）。
- ごほうび演出は**水着が最終段階**です。これより先の露出は描画しません。衣装チェンジの演出はクロスフェードとやわらかい光だけで、性的な強調はしません。
- 会話イベントは健全な大人の恋愛シミュレーションです（一緒に資格試験を目指す、励まし合う）。性的な描写はしません。会話イベント中の衣装は `outfit`（0〜3）で固定し、水着では表示しません。

## クレジット

- 音声: VOICEVOX:波音リツ（[VOICEVOX ENGINE](https://github.com/VOICEVOX/voicevox_engine) で生成）
- 立ち絵・背景: [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0) で生成（ポーズ補助に xinsir ControlNet openpose、背景除去に rembg isnet-anime）
- 3D モデル: VRoid 公式 β Ver AvatarSample_4（CC0）を改変（`assets/vrm/LICENSE.txt`）
- 3D 描画: [three.js](https://threejs.org/)（MIT）、[@pixiv/three-vrm](https://github.com/pixiv/three-vrm)（MIT）
