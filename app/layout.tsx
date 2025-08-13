import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ResponseLogger } from "@/components/response-logger";
import { cookies } from "next/headers";

const geistSans = localFont({
  src: "./fonts/GeistMono[wght].woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMono[wght].woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "WildFireFighters",
  description: "Engage in a real-time strategy game, 'WildFireFighters', to master firefighting tactics. Control fires, manage resources, and adapt strategies to become a hero and protect nature.",
  other: {
    "fc:frame": JSON.stringify({
      version: "next",
      imageUrl: "https://usdozf7pplhxfvrl.public.blob.vercel-storage.com/thumbnail_3153fa4a-6897-4361-943f-fbd210442208-sawkN4TqR63NWj5PnS5SxxkNKmtR43",
      button: {
        title: "Open with Ohara",
        action: {
          type: "launch_frame",
          name: "WildFireFighters",
          url: "https://thumb-locate-410.preview.series.engineering",
          splashImageUrl: "https://usdozf7pplhxfvrl.public.blob.vercel-storage.com/farcaster/splash_images/splash_image1.svg",
          splashBackgroundColor: "#ffffff"
        }
      }
    })
  }
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
const cookieStore = await cookies();
const requestId = cookieStore.get("x-request-id")?.value;


  return (
    <html lang="en">
      <head>
        {requestId && <meta name="x-request-id" content={requestId} />}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <ResponseLogger />
      </body>
    </html>
  );
}
