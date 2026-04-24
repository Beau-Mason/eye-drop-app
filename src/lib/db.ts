import Dexie, { Table } from "dexie";

export type Snap = {
  id: string; // uuid
  takenAt: string; // ISO文字列
  eye: "left" | "right" | "both";
  blob: Blob; // 画像本体
  smileScore?: number;
  note?: string; // 撮影後の中間コメント（＝研究者に送るフィードバック文）
  syncedAt?: string; // サーバー送信済み時刻（ISO）。未送信なら undefined
  participantId?: string; // 参加者ID（登録済みなら）
};

// IndexedDBはブラウザ × ドメイン（オリジン）単位

// 一行しか持たないテーブル
// db.settings.get("settings")で呼び出し
export type Settings = {
  id: "settings";
  deviceId: string; // 端末内匿名ID
  participantId?: string; // 登録後に付与
  inviteCode?: string; // 入力した招待コード（任意）
  token?: string; // 認証トークン（任意）
};

// Blob: Binary Large Object, immutable

// テーブルの例：
// | id | takenAt    | eye  | smileScore |
// | -- | ---------- | ---- | ---------- |
// | 1  | 2025-02-01 | left | 0.82       |
// | 2  | 2025-02-02 | both | 0.91       |

class AppDB extends Dexie {
  snaps!: Table<Snap, string>;
  settings!: Table<Settings, string>;
  constructor() {
    super("eyedrop-db"); // IndexedDB上のDB名を設定

    // "!:"はdefinite assignment
    // Dexieはこの時点でsnapsとsettingsを内部的に初期化するが，typescriptはそれを知らないので後に代入されることを宣言する
    this.version(1).stores({
      snaps: "id,takenAt",
    });
    this.version(2).stores({
      snaps: "id,takenAt,participantId",
      settings: "id", // settingsテーブルの主キーはidで設定．
    });
  }
}

// シングルトンとしてエクスポート．一度importされるとその後はキャッシュされた同じインスタンスを返す．
export const db = new AppDB();
