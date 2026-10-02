import { accountApi, createHttpClient, HttpError } from "@mmoexile/contracts";

const REFRESH_SECRET_KEY = "mmoexile_refresh_secret";

function stored(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function store(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode): the session just won't persist.
  }
}

/**
 * Talks to account-api through the dev server proxy (/api). Keeps the session
 * token in memory and only the refresh secret in localStorage.
 */
export class AccountClient {
  private sessionToken: string | undefined;
  private readonly call = createHttpClient({
    baseUrl: "/api",
    token: () => this.sessionToken,
  });

  /** Signs in with the stored refresh secret only; null if there is none. */
  async resume(): Promise<{ nickname: string } | null> {
    const refreshSecret = stored(REFRESH_SECRET_KEY);
    if (!refreshSecret) return null;
    try {
      const session = await this.call(accountApi.refresh, { refreshSecret });
      this.sessionToken = session.sessionToken;
      return { nickname: session.nickname };
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        store(REFRESH_SECRET_KEY, undefined);
        return null;
      }
      throw err;
    }
  }

  /** Signs in with the stored refresh secret, or creates a guest account. */
  async signIn(nickname: string): Promise<{ nickname: string }> {
    const refreshSecret = stored(REFRESH_SECRET_KEY);
    if (refreshSecret) {
      try {
        const session = await this.call(accountApi.refresh, { refreshSecret });
        this.sessionToken = session.sessionToken;
        return { nickname: session.nickname };
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 401)) throw err;
        store(REFRESH_SECRET_KEY, undefined); // stale secret: start fresh
      }
    }
    const guest = await this.call(accountApi.guestLogin, { nickname });
    this.sessionToken = guest.sessionToken;
    store(REFRESH_SECRET_KEY, guest.refreshSecret);
    return { nickname: guest.nickname };
  }

  listCharacters() {
    return this.call(accountApi.listCharacters, undefined);
  }

  createCharacter(classId: "wizard" | "knight") {
    return this.call(accountApi.createCharacter, { classId });
  }

  deleteCharacter(id: string) {
    return this.call(accountApi.deleteCharacter, undefined, {
      path: `/characters/${encodeURIComponent(id)}`,
    });
  }

  /** Where to connect, with a ticket for that server. */
  play(characterId: string) {
    return this.call(accountApi.play, { characterId });
  }

  forget(): void {
    this.sessionToken = undefined;
    store(REFRESH_SECRET_KEY, undefined);
  }
}
