import type { Metadata } from "next";
import MoreClient from "./more-client";

export const metadata: Metadata = { title: "Περισσότερα" };

export default function MorePage() {
  return <MoreClient />;
}
