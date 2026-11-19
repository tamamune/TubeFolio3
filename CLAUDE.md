# TubeFolio3 開発ルール

## ブラウザへの登録(Vivaldi / Chrome)— 「再起動すると消える」対策
- 開発用フォルダ(`C:\Claude\TubeFolio3`)は登録しない。コピー先の **`C:\Claude\TubeFolio3-ext`** を「パッケージ化されていない拡張機能」として登録する(開発フォルダのパスで登録すると、再起動で消えることがあった。TubeFolio2 と同じ)。
- 変更したら `deploy-ext.cmd` を実行し(`.git` / `CLAUDE.md` はコピーしない)、`vivaldi://extensions` で「再読み込み」。
- 別のPCで消える場合も、別フォルダにコピーして登録し直す。
- `manifest.json` の `key` を消さない(拡張機能ID `djehfhpekfhilamgpkbiffomiomnpgfg` を固定。OAuthのリダイレクトURIが紐づく)。
- 名前が `_` で始まるファイル・フォルダ(`_metadata` など)を置かない。

## Claude への必須ルール
- コードを編集したら、**毎回かならず** `deploy-ext.cmd` を実行して `C:\Claude\TubeFolio3-ext` にコピーする(コピーし忘れない)。終わったら「再読み込み」をユーザーに案内する。
