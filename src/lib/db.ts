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

// 撮影後アンケート: 自己効力感 (0-7) と自由記述 (任意)。
// 主キーは対応する Snap の id と同じにすることで 1:1 を保証する。
export type Survey = {
  id: string; // snap と同じ uuid
  snapId: string;
  takenAt: string; // 対応する撮影時刻
  answeredAt: string; // 回答時刻
  participantId?: string;
  selfEfficacy: number; // 0-7
  comment?: string; // 任意の自由記述
  syncedAt?: string;
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

class AppDB extends Dexie {
  snaps!: Table<Snap, string>;
  settings!: Table<Settings, string>;
  surveys!: Table<Survey, string>;
  constructor() {
    super("eyedrop-db");

    this.version(1).stores({
      snaps: "id,takenAt",
    });
    this.version(2).stores({
      snaps: "id,takenAt,participantId",
      settings: "id",
    });
    this.version(3).stores({
      snaps: "id,takenAt,participantId",
      settings: "id",
      surveys: "id,snapId,takenAt,participantId",
    });
  }
}

export const db = new AppDB();
