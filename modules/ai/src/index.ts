import { SlashCommandBuilder } from 'discord.js';
import { embeds, truncate, type NexusModule, type SlashCommand } from '@nexus/bot-core';
import { UpstreamError, withTimeout } from '@nexus/shared';

/**
 * Modul: KI-Assistent (Regel 33) — OPTIONAL.
 *
 * Es wird keine KI erfunden: das Modul spricht eine OpenAI-kompatible
 * Chat-Completions-API an (OpenAI, Azure OpenAI, lokale Server wie Ollama
 * mit kompatibler Route). Ohne `AI_API_KEY` bleibt es deaktiviert.
 *
 * Datenschutz: es werden nur der Prompt und die Sprache uebertragen —
 * keine Nachrichtenhistorie, keine Nutzer-IDs.
 */

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function complete(
  baseUrl: string, apiKey: string, model: string, prompt: string, locale: string,
): Promise<string> {
  const response = await withTimeout(
    fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content:
              `Du bist NEXUS, ein hilfreicher Assistent fuer Discord- und Roblox-Communities. ` +
              `Antworte kurz, sachlich und auf ${locale === 'de' ? 'Deutsch' : 'Englisch'}.`,
          },
          { role: 'user', content: prompt },
        ],
      }),
    }),
    20_000,
    'ai completion',
  );

  if (!response.ok) {
    throw new UpstreamError('ai', `HTTP ${response.status}`, { status: response.status });
  }
  const data = (await response.json()) as ChatCompletionResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? 'Keine Antwort erhalten.';
}

const ask: SlashCommand = {
  category: 'ai',
  moduleToggle: 'aiEnabled',
  feature: 'ai.assistant',
  cooldownMs: 20_000,
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Stellt dem KI-Assistenten eine Frage')
    .addStringOption((option) => option.setName('prompt').setDescription('Deine Frage').setRequired(true).setMaxLength(500)),
  execute: async ({ interaction, services, locale }) => {
    const { AI_API_KEY, AI_BASE_URL, AI_MODEL } = services.env;
    if (!AI_API_KEY) {
      await interaction.reply({
        embeds: [
          embeds.warning(
            'Das KI-Modul ist nicht konfiguriert. Setze `AI_API_KEY` (und optional `AI_BASE_URL`, `AI_MODEL`).\n' +
              'Es wird eine OpenAI-kompatible Chat-Completions-API erwartet.',
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    const prompt = interaction.options.getString('prompt', true);
    await interaction.deferReply();
    const answer = await complete(AI_BASE_URL, AI_API_KEY, AI_MODEL, prompt, locale);
    await interaction.editReply({
      embeds: [
        embeds
          .primary('🤖 NEXUS AI', truncate(answer, 4000))
          .addFields({ name: 'Frage', value: truncate(prompt, 1024) })
          .setFooter({ text: `Modell: ${AI_MODEL} · KI-Antworten koennen Fehler enthalten` }),
      ],
    });
  },
};

const aiModule: NexusModule = {
  name: 'ai',
  description: 'Optionaler KI-Assistent (OpenAI-kompatibel)',
  commands: [ask],
};

export default aiModule;
