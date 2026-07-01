import Image from "next/image";
import { cn } from "@/lib/utils";

const LOGO_SRC = "/forgechat-logo.png";

type BrandLogoProps = {
  /** Full logo for the sidebar — scales to fit without cropping. */
  variant?: "sidebar" | "compact";
  className?: string;
  priority?: boolean;
};

export function BrandLogo({
  variant = "sidebar",
  className,
  priority,
}: BrandLogoProps) {
  return (
    <Image
      src={LOGO_SRC}
      alt="ForgeChat — AI-Powered WhatsApp CRM"
      width={560}
      height={200}
      priority={priority}
      className={cn(
        variant === "sidebar"
          ? "h-auto max-h-[4.25rem] w-full max-w-[11.5rem] object-contain object-left"
          : "h-auto max-h-10 w-full max-w-[10rem] object-contain object-left",
        className,
      )}
    />
  );
}
