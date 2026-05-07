// 撮影後アンケート項目の定義。
// 1) 自己効力感（0-7、必須）
// 2) 自由記述（任意、最大2000文字）

export const SELF_EFFICACY_ITEM = {
  code: "self_efficacy" as const,
  text: "日常生活において、この健康行動を維持できるという確信の程度を評価してください。",
};
export const SELF_EFFICACY_MIN = 0;
export const SELF_EFFICACY_MAX = 7;
export const SELF_EFFICACY_LABELS = {
  min: "維持できる確信はまったくない",
  max: "維持できる確信が非常に高い",
};

export const COMMENT_ITEM = {
  code: "comment" as const,
  text: "このアプリや実験の使用中に感じたことやご意見があればお聞かせください（任意）",
};
export const COMMENT_MAX_LENGTH = 2000;
