/**
 * Nome do cookie da preferência "barra lateral recolhida".
 *
 * Vive fora de `components/shell.tsx` (que é "use client") de propósito: uma constante exportada de um
 * módulo de cliente chega ao servidor como REFERÊNCIA, não como texto — o layout leria `cookies().get(<ref>)`
 * e a preferência nunca seria encontrada, sem erro de tipo nem de build.
 */
export const COOKIE_NAV = "seahub_nav";
