import Dexie, { Table } from "dexie";

export type Snap = {
  id: string; // uuid
  takenAt: string; // ISO文字列
  eye: "left" | "right" | "both";
  blob: Blob; // 画像本体
  smileScore?: number; // 将来用
  note?: string; // 将来用
  synced?: boolean; // 将来サーバ同期用
};

class AppDB extends Dexie {
  snaps!: Table<Snap, string>;
  constructor() {
    super("eyedrop-db");
    this.version(1).stores({
      snaps: "id,takenAt", // takenAtで並べ替えしやすく
    });
  }
}

export const db = new AppDB();
