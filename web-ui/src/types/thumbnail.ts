export type ThumbnailOptions = { color: "original" | "neutral"; axonometric: boolean; fit: boolean };
export type ThumbnailGeneration = {
  options: ThumbnailOptions;
  busy: boolean;
  disabled: boolean;
  message: string;
  error: boolean;
  update: (options: Partial<ThumbnailOptions>) => void;
  run: () => Promise<void>;
};
