export type T3CodeOrigin = {
  readonly url: string;
};

export type T3CodeAuth = {
  readonly token: string;
};

export type T3CodeConnection = {
  readonly origin: T3CodeOrigin;
  readonly auth: T3CodeAuth;
};
