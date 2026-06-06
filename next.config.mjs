/** @type {import('next').NextConfig} */
const deployTarget = process.env.EVENTFUND_DEPLOY_TARGET ?? "local";
const standaloneOutput = deployTarget === "cloud";

const nextConfig = {
  typedRoutes: false,
  ...(standaloneOutput ? { output: "standalone" } : {})
};

export default nextConfig;
