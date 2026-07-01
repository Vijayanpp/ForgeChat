import Image from "next/image";
import { cn } from "@/lib/utils";

const LOGO_SRC = "/agentforge-logo.png";

type BrandLogoProps = {
  /** Sidebar mark — emblem crop only. */
  variant?: "mark" | "wordmark";
  className?: string;
  priority?: boolean;
};

export function BrandLogo({
  variant = "wordmark",
  className,
  priority,
}: BrandLogoProps) {
  if (variant === "mark") {
    return (
      <div
        className={cn(
          "relative h-9 w-9 shrink-0 overflow-hidden rounded-lg",
          className,
        )}
      >
        <Image
          src={LOGO_SRC}
          alt="AgentForge"
          width={144}
          height={144}
          priority={priority}
          className="absolute left-1/2 top-0 h-auto w-[220%] max-w-none -translate-x-1/2 object-cover object-top"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative mx-auto h-20 w-44 overflow-hidden sm:h-24 sm:w-52",
        className,
      )}
    >
      <Image
        src={LOGO_SRC}
        alt="AgentForge"
        width={320}
        height={320}
        priority={priority}
        className="absolute inset-x-0 top-0 h-auto w-full object-contain object-top"
      />
    </div>
  );
}
