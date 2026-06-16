declare global {
  var SillyTavern:
    | {
        getContext?: () => unknown;
      }
    | undefined;
}

export {};

