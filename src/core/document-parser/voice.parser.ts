import { geminiKeyManager } from "../ai/gemini-client.js";
import { aiCircuitBreaker } from "../ai/circuit-breaker.js";
import { parseTransactionFromText, ParsedTextTransaction } from "../ai/parsers/text-transaction.parser.js";
import { logger } from "../utils/logger.js";

export interface VoiceParseResult {
  transcription: string;
  transaction?: ParsedTextTransaction | null;
  error?: string;
}

const VOICE_TRANSCRIBE_PROMPT = `
Dengarkan audio suara berikut dari operator/petugas unit SPPG Program Makanan Bergizi Gratis (MBG) Badan Gizi Nasional.
Tugas Anda:
1. Transkripsikan isi rekaman suara ini ke dalam teks bahasa Indonesia yang jelas, rapi, dan akurat.
2. Normalkan singkatan lisan seperti "rb", "k", "rebu", "jt", "juta", "pagu", "nota".

Kembalikan HANYA teks transkripsi bersih tanpa komentar tambahan.
`;

/**
 * Transcribes Telegram voice message (.oga / audio) and attempts to extract financial transactions
 */
export async function parseVoiceNote(
  audioBuffer: Buffer,
  mimeType = "audio/ogg",
  sppgUnit = "SPPG Patila"
): Promise<VoiceParseResult> {
  // Check circuit breaker first
  if (aiCircuitBreaker.isOpen()) {
    logger.warn("Circuit breaker is OPEN. Voice note transcription skipped.");
    return {
      transcription: "",
      error: "⚠️ Fitur transkripsi suara memerlukan AI yang saat ini sedang dalam pemeliharaan. Silakan ketik belanjaan Anda melalui teks biasa.",
    };
  }

  try {
    const transcription = await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: VOICE_TRANSCRIBE_PROMPT,
      });

      const audioPart = {
        inlineData: {
          data: audioBuffer.toString("base64"),
          mimeType,
        },
      };

      const result = await model.generateContent([audioPart]);
      return result.response.text().trim();
    });

    aiCircuitBreaker.recordSuccess();

    let transaction: ParsedTextTransaction | null = null;
    if (transcription.length > 0) {
      transaction = await parseTransactionFromText(transcription, sppgUnit);
    }

    return {
      transcription,
      transaction,
    };
  } catch (err: any) {
    logger.error({ err: err?.message || err }, "Voice note processing failed");
    aiCircuitBreaker.recordFailure();
    return {
      transcription: "",
      error: "⚠️ Gagal memproses pesan suara. Silakan ketik transaksi belanja Anda via pesan teks.",
    };
  }
}
