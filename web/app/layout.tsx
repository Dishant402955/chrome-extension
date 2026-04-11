import {  Geist_Mono, Inter } from "next/font/google"

// @ts-expect-error
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils";
import { ModeToggle } from "@/components/theme-toggle";

const inter = Inter({subsets:['latin'],variable:'--font-sans'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", inter.variable)}
    >
      <body className="h-full w-full">
        <ThemeProvider 
                    attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
        
        >
         <div className="absolute top-4 left-8">
          <ModeToggle/>
          </div> 
          {children}</ThemeProvider>
      </body>
    </html>
  )
}
