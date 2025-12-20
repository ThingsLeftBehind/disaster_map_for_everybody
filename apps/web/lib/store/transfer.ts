import { decodeTransferCode as decodeImpl, encodeTransferCode as encodeImpl } from './transfer-core.mjs';

export const encodeTransferCode: (payload: unknown) => string = encodeImpl as any;
export const decodeTransferCode: (code: string) => { ok: true; payload: any } | { ok: false; message: string } =
  decodeImpl as any;
