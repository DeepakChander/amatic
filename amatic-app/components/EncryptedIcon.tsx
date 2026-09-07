import { Tooltip } from "@amatic/amatic/components/Tooltip";
import { shield } from "@amatic/amatic/components/icons";
import { useI18n } from "@amatic/amatic/i18n";

export const EncryptedIcon = () => {
  const { t } = useI18n();

  return (
    <div
      className="encrypted-icon tooltip"
      aria-label={t("encrypted.link")}
    >
      <Tooltip label={t("encrypted.tooltip")} long={true}>
        {shield}
      </Tooltip>
    </div>
  );
};
