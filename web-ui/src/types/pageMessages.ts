/** 页面统一消息类型。handler 返回 true 表示已处理，false/void 触发默认行为。 */
export type PageMessage =
  | { type: "tree:select-file"; path: string }
  | { type: "tree:pick-dir"; path: string }
  | { type: "tree:pick-file"; path: string };

export type PageMessageHandler = (msg: PageMessage) => boolean | void | Promise<boolean | void>;
