import { constants, promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_BYTES = 32;

export class AiCredentialVault {
  private keyPromise?: Promise<Buffer>;

  constructor(private readonly keyFile = process.env.SAMVEV_AI_MASTER_KEY_FILE ?? resolve(process.cwd(), '.local/ai-master-key')) {}

  async encrypt(householdId: string, secret: string): Promise<string> {
    const key = await this.key();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(householdId, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', nonce.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  async decrypt(householdId: string, encoded: string): Promise<string> {
    const [version, nonceText, tagText, ciphertextText, extra] = encoded.split('.');
    if (version !== 'v1' || !nonceText || !tagText || !ciphertextText || extra) throw new Error('AI_CREDENTIAL_INVALID');
    const decipher = createDecipheriv('aes-256-gcm', await this.key(), Buffer.from(nonceText, 'base64url'));
    decipher.setAAD(Buffer.from(householdId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
  }

  private key(): Promise<Buffer> { return this.keyPromise ??= this.loadOrCreateKey(); }

  private async loadOrCreateKey(): Promise<Buffer> {
    await fs.mkdir(dirname(this.keyFile), { recursive: true, mode: 0o700 });
    try {
      const generated = randomBytes(KEY_BYTES);
      const handle = await fs.open(this.keyFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try { await handle.writeFile(generated.toString('base64url'), { encoding: 'utf8' }); }
      finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = await fs.stat(this.keyFile);
    if ((stat.mode & 0o077) !== 0) throw new Error('AI_MASTER_KEY_PERMISSIONS');
    const key = Buffer.from((await fs.readFile(this.keyFile, 'utf8')).trim(), 'base64url');
    if (key.length !== KEY_BYTES) throw new Error('AI_MASTER_KEY_INVALID');
    return key;
  }
}
