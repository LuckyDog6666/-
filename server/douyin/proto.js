// 极简 protobuf 解码器（无第三方依赖）：只按字段号取出我们需要的字段，
// 抖音协议新增/修改其它字段时不会影响解析（比编译 .proto 更抗变化）。

export class Reader {
  constructor(buf) {
    this.b = buf;
    this.p = 0;
    this.end = buf.length;
  }
  eof() { return this.p >= this.end; }
  varintBig() {
    let result = 0n, shift = 0n, byte;
    do {
      if (this.p >= this.end) throw new Error('varint 越界');
      byte = this.b[this.p++];
      result |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
      if (shift > 70n) throw new Error('varint 过长');
    } while (byte & 0x80);
    return result;
  }
  bytes(n) {
    if (this.p + n > this.end) throw new Error('length 越界');
    const s = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return s;
  }
  // 逐个读取字段：返回 {no, wt, v}
  *fields() {
    while (!this.eof()) {
      const tag = Number(this.varintBig());
      const no = tag >>> 3, wt = tag & 7;
      let v;
      if (wt === 0) v = this.varintBig();
      else if (wt === 1) v = this.bytes(8);
      else if (wt === 2) v = this.bytes(Number(this.varintBig()));
      else if (wt === 5) v = this.bytes(4);
      else throw new Error('不支持的 wire type ' + wt);
      yield { no, wt, v };
    }
  }
}

const td = new TextDecoder('utf-8');

function convert(type, f) {
  switch (type) {
    case 'u64': return f.wt === 0 ? f.v.toString() : f.wt === 1 ? Buffer.from(f.v).readBigUInt64LE().toString() : '';
    case 'i64': return f.wt === 0 ? BigInt.asIntN(64, f.v).toString() : '';
    case 'int': return f.wt === 0 ? Number(BigInt.asIntN(64, f.v)) : 0;
    case 'u32': return f.wt === 0 ? Number(f.v & 0xffffffffn) : 0;
    case 'bool': return f.wt === 0 ? f.v !== 0n : false;
    case 'string': return f.wt === 2 ? td.decode(f.v) : '';
    case 'bytes': return f.wt === 2 ? f.v : null;
    default: return undefined;
  }
}

/**
 * 按 schema 解码。schema = { 字段号: [名称, 类型, (子schema)] }，类型后缀 [] 表示 repeated。
 * 类型：u64(字符串) i64(字符串) int u32 bool string bytes msg
 */
export function decode(buf, schema) {
  const out = {};
  const r = new Reader(buf);
  for (const f of r.fields()) {
    const def = schema[f.no];
    if (!def) continue;
    let [name, type, sub] = def;
    const repeated = type.endsWith('[]');
    if (repeated) type = type.slice(0, -2);
    let val;
    if (type === 'msg') {
      if (f.wt !== 2) continue;
      try { val = decode(f.v, sub); } catch { continue; }
    } else {
      val = convert(type, f);
      if (val === undefined) continue;
    }
    if (repeated) (out[name] ||= []).push(val);
    else out[name] = val;
  }
  return out;
}

// ---- 编码器（仅用于自检测试，构造假消息） ----
export function encodeVarint(n) {
  let v = BigInt(n);
  const out = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
}
export function encode(fields) {
  // fields: [[no, kind, value]] kind: 'varint' | 'bytes' | 'string' | 'msg'
  const parts = [];
  for (const [no, kind, value] of fields) {
    if (kind === 'varint') { parts.push(...encodeVarint((no << 3) | 0), ...encodeVarint(typeof value === 'boolean' ? (value ? 1 : 0) : value)); }
    else {
      const data = kind === 'string' ? Buffer.from(String(value), 'utf8') : kind === 'msg' ? encode(value) : Buffer.from(value);
      parts.push(...encodeVarint((no << 3) | 2), ...encodeVarint(data.length), ...data);
    }
  }
  return Buffer.from(parts);
}
