// AudioWorklet da escuta dos 15 s (live_amd) do webphone.
// Junta o canal 0 em blocos de 4096 amostras float e entrega ao thread
// principal, que reduz para PCM 16 kHz e envia à AssemblyAI.
// Arquivo estático em /public porque a CSP só libera script de 'self'
// (Blob URL seria bloqueado). Carregado por src/features/integrations/webphone/live-amd-pump.ts.
const BLOCK = 4096;

class LiveAmdCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BLOCK);
    this.length = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.length++] = channel[i];
        if (this.length === BLOCK) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(BLOCK);
          this.length = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('live-amd-capture', LiveAmdCaptureProcessor);
