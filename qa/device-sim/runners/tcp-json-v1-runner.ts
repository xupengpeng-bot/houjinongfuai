export interface LengthPrefixedFrame {
  length: number;
  body: string;
}

export function encodeLengthPrefixedJson(input: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(input), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

export function decodeLengthPrefixedJson(frame: Buffer): LengthPrefixedFrame {
  const length = frame.readUInt32BE(0);
  return {
    length,
    body: frame.subarray(4, 4 + length).toString('utf8')
  };
}
