import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";
import { useWhatsApp } from "@/store/whatsapp";

/** The QR a native account is waiting for, while it is being linked. */
export function Pairing({ accountId }: { accountId: string }) {
  const qr = useWhatsApp((s) => s.qr[accountId]);
  const [image, setImage] = useState("");
  useEffect(() => {
    if (!qr) {
      setImage("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(qr.code, { width: 260, margin: 1 })
      .then((url) => !cancelled && setImage(url))
      .catch(() => !cancelled && setImage(""));
    return () => {
      cancelled = true;
    };
  }, [qr]);
  return (
    <div className="flex-1 grid place-items-center p-6 bg-[#efeae2] dark:bg-neutral-950">
      <div className="rounded-2xl bg-white dark:bg-neutral-900 shadow-sm p-6 text-center space-y-4 max-w-sm">
        <h2 className="font-semibold">Link this account</h2>
        {image ? (
          <img src={image} alt="WhatsApp pairing QR code" className="w-[260px] h-[260px] mx-auto bg-white p-2 rounded-lg" />
        ) : (
          <div className="w-[260px] h-[260px] mx-auto grid place-items-center text-neutral-500">
            <Loader2 className="animate-spin" />
          </div>
        )}
        <ol className="text-sm text-neutral-500 text-left list-decimal list-inside space-y-1">
          <li>Open WhatsApp on your phone</li>
          <li>Go to Settings → Linked devices</li>
          <li>Tap Link a device and scan this code</li>
        </ol>
      </div>
    </div>
  );
}
