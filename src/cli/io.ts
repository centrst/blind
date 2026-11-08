/** What the commands need from their surroundings, so tests can supply it. */
export interface IO {
  readStdin(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
  /** The user's home directory, for the default BLIND_HOME. */
  homedir: string;
  /** True when stdin is a terminal, so there is nothing to read. */
  stdinIsTty: boolean;
  /** The current user's id, or undefined where there is none (Windows), which skips the owner and mode checks. */
  uid: number | undefined;
}
