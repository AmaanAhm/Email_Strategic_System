"use client";

import * as React from "react";
import { avatarClasses, initials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * Sender avatar: shows the Google profile photo when available, falling back to
 * a deterministic colored-initials tile if there's no image or it fails to load.
 */
export function SenderAvatar({
  image,
  name,
  email,
  className,
}: {
  image?: string | null;
  name?: string | null;
  email: string;
  className?: string;
}) {
  const [broken, setBroken] = React.useState(false);
  const showImage = Boolean(image) && !broken;

  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold",
        !showImage && avatarClasses(email),
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- external Google avatar, no optimization/allowlist needed
        <img
          src={image as string}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initials(name ?? email)
      )}
    </span>
  );
}
