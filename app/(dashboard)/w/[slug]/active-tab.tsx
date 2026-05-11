"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  label: string;
  href: string;
}

export default function ActiveTab({ label, href }: Props) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={`px-3 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors border-b-2 ${
        isActive
          ? "border-[#02773b] text-[#02773b] dark:text-[#60c988] bg-[#02773b]/5 dark:bg-[#02773b]/10"
          : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
      }`}
    >
      {label}
    </Link>
  );
}
