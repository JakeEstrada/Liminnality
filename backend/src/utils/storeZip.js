const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const buf = Buffer.allocUnsafe(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

function u32(value) {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

/** Writes an uncompressed zip. `files` is [{ name, buffer }]. */
function writeStoreZip(res, files) {
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(String(file.name || 'photo.jpg'), 'utf8');
    const data = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || '');
    const crc = crc32(data);
    const local = Buffer.concat([
      Buffer.from('PK\x03\x04'),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    res.write(local);
    res.write(data);
    central.push({ name, crc, size: data.length, offset });
    offset += local.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const entry of central) {
    const record = Buffer.concat([
      Buffer.from('PK\x01\x02'),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(entry.crc),
      u32(entry.size),
      u32(entry.size),
      u16(entry.name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(entry.offset),
      entry.name,
    ]);
    res.write(record);
    centralSize += record.length;
  }

  res.write(
    Buffer.concat([
      Buffer.from('PK\x05\x06'),
      u16(0),
      u16(0),
      u16(central.length),
      u16(central.length),
      u32(centralSize),
      u32(centralStart),
      u16(0),
    ]),
  );
  res.end();
}

module.exports = { writeStoreZip };
