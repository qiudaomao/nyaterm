import { useTranslation } from "react-i18next";
import { SelectItem } from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import {
  MAX_COMMAND_SUGGESTION_MAX_CHARS,
  MAX_COMMAND_SUGGESTION_MIN_CHARS,
  MIN_COMMAND_SUGGESTION_MAX_CHARS,
  MIN_COMMAND_SUGGESTION_MIN_CHARS,
  normalizeCommandSuggestionMaxChars,
  normalizeCommandSuggestionMinChars,
} from "@/lib/interactionSettings";
import {
  SettingInput,
  SettingNumberInput,
  SettingRow,
  SettingSection,
  SettingSelect,
  SettingSwitch,
} from "./SettingFormItems";

export function InteractionTab() {
  const { t } = useTranslation();
  const { appSettings, updateAppSettings } = useApp();

  return (
    <div className="space-y-5">
      <SettingSection contentClassName="space-y-5">
        <SettingRow label={t("settings.copyOnSelect")} desc={t("settings.copyOnSelectDesc")}>
          <SettingSwitch
            checked={appSettings.interaction.copy_on_select}
            onChange={(v) =>
              updateAppSettings({ interaction: { ...appSettings.interaction, copy_on_select: v } })
            }
          />
        </SettingRow>

        <SettingRow label={t("settings.rightClickPaste")} desc={t("settings.rightClickPasteDesc")}>
          <SettingSwitch
            checked={appSettings.interaction.right_click_paste}
            onChange={(v) =>
              updateAppSettings({
                interaction: { ...appSettings.interaction, right_click_paste: v },
              })
            }
          />
        </SettingRow>

        <SettingRow
          label={t("settings.commandSuggestions")}
          desc={t("settings.commandSuggestionsDesc")}
        >
          <SettingSwitch
            checked={appSettings.interaction.command_suggestions_enabled}
            onChange={(v) =>
              updateAppSettings({
                interaction: {
                  ...appSettings.interaction,
                  command_suggestions_enabled: v,
                },
              })
            }
          />
        </SettingRow>

        {appSettings.interaction.command_suggestions_enabled && (
          <>
            <SettingNumberInput
              label={t("settings.commandSuggestionsMinChars")}
              desc={t("settings.commandSuggestionsMinCharsDesc")}
              value={appSettings.interaction.command_suggestion_min_chars}
              min={MIN_COMMAND_SUGGESTION_MIN_CHARS}
              max={Math.min(
                MAX_COMMAND_SUGGESTION_MIN_CHARS,
                appSettings.interaction.command_suggestion_max_chars,
              )}
              step={1}
              controlClassName="max-w-sm"
              onChange={(v) =>
                updateAppSettings({
                  interaction: {
                    ...appSettings.interaction,
                    command_suggestion_min_chars: normalizeCommandSuggestionMinChars(
                      v,
                      appSettings.interaction.command_suggestion_max_chars,
                    ),
                  },
                })
              }
            />

            <SettingNumberInput
              label={t("settings.commandSuggestionsMaxChars")}
              desc={t("settings.commandSuggestionsMaxCharsDesc")}
              value={appSettings.interaction.command_suggestion_max_chars}
              min={Math.max(
                MIN_COMMAND_SUGGESTION_MAX_CHARS,
                appSettings.interaction.command_suggestion_min_chars,
              )}
              max={MAX_COMMAND_SUGGESTION_MAX_CHARS}
              step={1}
              controlClassName="max-w-sm"
              onChange={(v) =>
                updateAppSettings({
                  interaction: {
                    ...appSettings.interaction,
                    command_suggestion_max_chars: normalizeCommandSuggestionMaxChars(
                      v,
                      appSettings.interaction.command_suggestion_min_chars,
                    ),
                  },
                })
              }
            />
          </>
        )}

        <SettingInput
          label={t("settings.wordSeparators")}
          desc={t("settings.wordSeparatorsDesc")}
          value={appSettings.interaction.word_separators}
          controlClassName="max-w-2xl"
          onChange={(e) =>
            updateAppSettings({
              interaction: { ...appSettings.interaction, word_separators: e.target.value },
            })
          }
        />

        <SettingSelect
          label={t("settings.defaultEncoding")}
          value={appSettings.interaction.default_encoding}
          controlClassName="max-w-sm"
          onValueChange={(v) =>
            updateAppSettings({ interaction: { ...appSettings.interaction, default_encoding: v } })
          }
        >
          <SelectItem value="UTF-8">UTF-8</SelectItem>
          <SelectItem value="GBK">GBK</SelectItem>
        </SettingSelect>
      </SettingSection>
    </div>
  );
}
