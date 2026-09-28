/**
 * A CASA dos dados desta instalação.
 *
 * Tudo que o produto grava mora debaixo de uma raiz só. Ela existe para que
 * uma segunda instância — demonstração, homologação, a conta que um revisor de
 * marketplace vai abrir — seja *fisicamente* outra instalação, com outro
 * diretório, e não a mesma com um login diferente.
 *
 * Isolar por permissão exigiria um sistema de papéis que este produto não tem.
 * Isolar por diretório é o que dá para prometer sem mentir: o que a demo não
 * consegue ver, ela não consegue ver porque NÃO ESTÁ LÁ.
 *
 * `VS_HOME` troca a raiz inteira. As variáveis específicas de cada módulo
 * (`VSCRM_DIR` e companhia) continuam valendo e têm precedência — elas servem
 * para teste, que aponta um módulo só para uma pasta descartável.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/* A casa da instalação PADRÃO (a de produção), sem olhar VS_HOME. Só pra quem
   precisa CONFERIR a produção de fora dela — a trava da demo lê o token do
   Telegram de lá pra se recusar a usá-lo. Gravar continua sendo só na casa(). */
export const casaPadrao = () => join(homedir(), '.qa-gate');
export const casa = () => process.env.VS_HOME || casaPadrao();

/** Caminho dentro da casa: `dentroDaCasa('vsbot')` → <casa>/vsbot */
export const dentroDaCasa = (...partes) => join(casa(), ...partes);
