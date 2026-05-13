"use client";

import type { Widget, DashboardData } from "@/lib/widgets";
import WidgetCounter from "./widget-counter";
import WidgetKpi from "./widget-kpi";
import WidgetBar from "./widget-bar";
import WidgetPie from "./widget-pie";
import WidgetList from "./widget-list";

/**
 * Dispatch a widget descriptor to its renderer. Unknown types render as
 * a small placeholder so an old layout with retired widget types still
 * loads instead of throwing.
 */
export default function WidgetRenderer({
  widget,
  data,
}: {
  widget: Widget;
  data: DashboardData | null;
}) {
  switch (widget.type) {
    case "counter":
      return <WidgetCounter widget={widget} data={data} />;
    case "kpi":
      return <WidgetKpi widget={widget} data={data} />;
    case "bar":
      return <WidgetBar widget={widget} data={data} />;
    case "pie":
      return <WidgetPie widget={widget} data={data} />;
    case "list":
      return <WidgetList widget={widget} data={data} />;
    default:
      return (
        <div className="flex h-full items-center justify-center text-xs italic text-gray-400">
          Unknown widget &ldquo;{widget.type}&rdquo;
        </div>
      );
  }
}
