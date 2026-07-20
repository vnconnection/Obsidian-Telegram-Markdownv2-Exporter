import { Notice, Plugin, TFile } from "obsidian";

import { convertToTelegramMarkdownV2 } from "./converter";

export default class TelegramMarkdownV2ExporterPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addRibbonIcon("clipboard", "Copy current note as Telegram MarkdownV2", () => {
      void this.copyCurrentNote();
    });

    this.addCommand({
      id: "copy-current-note-as-telegram-markdownv2",
      name: "Copy current note as Telegram MarkdownV2",
      callback: () => {
        void this.copyCurrentNote();
      }
    });
  }

  private async copyCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("Telegram MarkdownV2 Exporter: open a Markdown note first.");
      return;
    }

    try {
      const source = await this.app.vault.read(file);
      const exported = convertToTelegramMarkdownV2(source);
      await navigator.clipboard.writeText(exported);
      new Notice(`Copied ${file.basename} as Telegram MarkdownV2.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Telegram MarkdownV2 Exporter: ${message}`);
      console.error("Telegram MarkdownV2 Exporter failed:", error);
    }
  }
}
