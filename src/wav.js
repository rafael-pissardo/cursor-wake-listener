export function decodeWavPcm16(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (ascii(buffer, 0, 4) !== "RIFF" || ascii(buffer, 8, 4) !== "WAVE") {
    throw new Error("Arquivo WAV invalido");
  }

  let offset = 12;
  let channels = 1;
  let sampleRate = 16_000;
  let bits = 16;
  let dataOffset = 0;
  let dataBytes = 0;

  while (offset + 8 <= buffer.length) {
    const chunk = ascii(buffer, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (chunk === "fmt ") {
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    } else if (chunk === "data") {
      dataOffset = start;
      dataBytes = size;
      break;
    }
    offset = start + size + (size % 2);
  }

  if (!dataBytes) throw new Error("WAV sem chunk de dados");
  if (bits !== 16) throw new Error(`WAV precisa ser PCM 16-bit, veio ${bits}`);

  const framesTotal = Math.floor(dataBytes / 2);
  const interleaved = new Int16Array(framesTotal);
  for (let i = 0; i < framesTotal; i += 1) {
    interleaved[i] = view.getInt16(dataOffset + i * 2, true);
  }
  if (channels === 1) return { sampleRate, pcm: interleaved };

  const frames = Math.floor(interleaved.length / channels);
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += interleaved[i * channels + channel];
    }
    mono[i] = Math.round(sum / channels);
  }
  return { sampleRate, pcm: mono };
}

export function encodeWavPcm16(pcm, sampleRate = 16_000) {
  const samples = pcm ?? new Int16Array(0);
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buffer;
}

export function resampleTo16k(pcm, sampleRate) {
  if (sampleRate === 16_000) return pcm;
  const ratio = sampleRate / 16_000;
  const out = new Int16Array(Math.max(1, Math.floor(pcm.length / ratio)));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = pcm[Math.min(pcm.length - 1, Math.round(i * ratio))];
  }
  return out;
}

function ascii(buffer, start, length) {
  return Buffer.from(buffer.buffer, buffer.byteOffset + start, length).toString("ascii");
}
