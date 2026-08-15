/**
 * A curated emoji set for the picker — not exhaustive (that's what the OS
 * emoji picker, Win+., is for), just enough common ones to insert without
 * leaving the app. Typing or pasting any emoji directly into the notepad or
 * a text box already works on its own; this is a convenience on top.
 */

export interface EmojiCategory {
  label: string;
  emoji: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    label: "Smileys",
    emoji: [
      "😀", "😄", "😂", "🙂", "😉", "😍", "😎", "🤔", "😅", "😴",
      "😭", "😡", "🥳", "😇", "🤯", "🥺", "😬", "🤩", "🙃", "😱",
    ],
  },
  {
    label: "Gestures",
    emoji: [
      "👍", "👎", "👋", "🙌", "👏", "🤝", "✌️", "🤞", "🤟", "👌",
      "💪", "🙏", "👉", "👀", "🫡", "🤙", "✋", "🫶",
    ],
  },
  {
    label: "Hearts",
    emoji: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💯",
      "✨", "🔥", "⭐", "🌟", "💥", "💫",
    ],
  },
  {
    label: "Objects",
    emoji: [
      "💡", "📌", "📎", "📝", "✏️", "🔖", "📚", "🔍", "🔒", "🔓",
      "⚙️", "🛠️", "💻", "📱", "⌚", "🎯", "🏆", "🎁",
    ],
  },
  {
    label: "Status",
    emoji: [
      "✅", "❌", "⚠️", "❓", "❗", "🚫", "🆗", "🔴", "🟡", "🟢",
      "🔵", "⬜", "⬛", "🔺", "🔻", "♻️",
    ],
  },
  {
    label: "Nature",
    emoji: [
      "🌱", "🌿", "🌸", "🌻", "🌈", "☀️", "🌙", "⛅", "❄️", "🌊",
      "🐱", "🐶", "🦋", "🐢",
    ],
  },
  {
    label: "Food & Fun",
    emoji: [
      "☕", "🍕", "🍎", "🍰", "🍫", "🎉", "🎈", "🎮", "🎵", "✈️",
      "🚀", "🗓️",
    ],
  },
];
