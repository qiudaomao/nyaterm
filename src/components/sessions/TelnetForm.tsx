import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";

interface TelnetFormProps {
  host: string;
  setHost: (v: string) => void;
  port: number;
  setPort: (v: number) => void;
}

export function TelnetForm({ host, setHost, port, setPort }: TelnetFormProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Label className="text-[0.6875rem] text-muted-foreground">{t("dialog.host")}</Label>
          <Input
            className="mt-1 text-xs h-8"
            placeholder="192.168.1.100"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-32">
          <Label className="text-[0.6875rem] text-muted-foreground">{t("dialog.port")}</Label>
          <NumberInput
            className="mt-1 [&_button]:h-8 [&_button]:w-8 [&_input]:h-8 [&_input]:text-xs"
            value={port}
            onChange={setPort}
            min={1}
            max={65535}
          />
        </div>
      </div>
    </div>
  );
}
