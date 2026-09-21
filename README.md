# Quadra — Multi-view

Quadra é um aplicativo desktop Electron para abrir de 1 a 16 páginas independentes em uma única janela. Cada painel usa uma `WebContentsView` completa do Chromium, portanto páginas que bloqueiam incorporação continuam podendo ser abertas diretamente no painel.

## Como rodar

```bash
npm install
npm run dev
```

Para gerar o build e o instalador Windows:

```bash
npm run build
npm run dist
```

O instalador é escrito em `release/`. Depois de instalado, o programa funciona sem Vite ou servidor local.

## Atualizações automáticas no Windows

Somente o aplicativo empacotado para Windows consulta o release estável do GitHub ao abrir. Se houver uma versão nova, o Quadra pergunta antes de baixar; depois do download, pergunta novamente antes de reiniciar. **Reiniciar e instalar** interrompe os painéis abertos. **Agora não** e **Depois** não instalam nada em segundo plano; a atualização pode ser aceita na próxima abertura.

O primeiro build com o updater precisa ser instalado manualmente. A distribuição atual para conhecidos é sem certificado de assinatura Windows: o instalador deve ser obtido do release e aceito manualmente.

O workflow `.github/workflows/windows-release.yml` roda somente quando uma tag `v*` é enviada. Antes de publicar, ele exige que a tag seja exatamente `v${package.version}`, executa `npm ci`, typecheck, testes e build NSIS, e valida os nomes/metadata dos artefatos. Para preparar a versão `1.0.9` após a revisão:

Não execute os dois últimos comandos durante esta preparação; eles são o envio explícito que inicia o workflow.

```bash
npm ci
npm run typecheck
npm test
npm run dist:release
npm run test:release-metadata
git tag v1.0.9
git push multiview-desktop v1.0.9
```

O workflow publica no release do repositório `bernard-014/multiview-desktop` `Quadra-Setup-1.0.9.exe`, `Quadra-Setup-1.0.9.exe.blockmap` e `latest.yml`, com os nomes exatos gerados em `release/`. O `latest.yml` aponta para o instalador e seu hash; sem ele o updater não encontra a versão. O `.blockmap` permite o download diferencial e também deve ser publicado. Não renomeie esses arquivos depois de gerar o metadata.

`npm run dist` e `npm run dist:release` são builds locais sem publicação; nenhum deles exige certificado. No CI, `CSC_IDENTITY_AUTO_DISCOVERY=false` evita procurar certificado automaticamente, enquanto `verifyUpdateCodeSignature: true` permanece ativo. Sem certificado, o `app-update.yml` não contém `publisherName`, então o `NsisUpdater` não tem identidade para validar assinatura: não declare esses instaladores como assinados. O updater ainda usa HTTPS do GitHub, hash SHA-512 do `latest.yml` e `disableWebInstaller`; essas verificações não devem ser desativadas. O workflow usa somente o `GITHUB_TOKEN` efêmero com `contents: write` para criar/atualizar o release; nenhum token é gravado no repositório ou no aplicativo.

Usuários que ainda estiverem em uma versão anterior ao updater devem instalar manualmente a primeira versão que o contém. Se um release apresentar problema, publique uma versão superior (por exemplo, `1.0.10`) em vez de reutilizar a versão defeituosa; como recuperação, reinstale manualmente um instalador válido e depois deixe o updater avançar para a versão superior.

## Uso

1. Escolha qualquer quantidade entre 1 e 16 telas ou clique em **Começar com uma tela**.
2. Cole uma URL em cada painel e clique em **Abrir** ou **Abrir todos**.
   Para o WeddBets, clique no botão **WeddBets** do painel, faça login uma vez e escolha o jogo no catálogo. O player aberto pelo site é enviado diretamente ao painel; nas escolhas seguintes, o destino avança para a próxima tela vazia.
3. Use **+ Adicionar tela** para montar a sessão gradualmente; o botão direciona o foco ao novo painel. A lixeira de cada painel remove aquela tela e recalcula automaticamente a melhor composição para a quantidade restante.
4. Abra **Organizar**, escolha a composição, marque as telas principais e selecione uma miniatura de posição. Clique em **Aplicar** para confirmar. **Cancelar**, Escape e o botão de fechar descartam a prévia.
5. Escolha **Sem destaques**, **Organizar automaticamente**, **Desfazer** ou altere a quantidade no seletor **Telas**.
6. Use **Voltar**, **Tela Cheia**, o menu de opções e o botão de edição de cada painel.

A barra de controles fica sempre visível sobre os painéis, inclusive durante a reprodução e em tela cheia. Em janelas menores, os botões se distribuem em mais de uma linha; o menu de organização acompanha a altura da barra.

Os players do WeddBets são limitados ao espaço real de cada painel. O vídeo preserva a proporção e usa o maior tamanho que cabe, mantendo toda a imagem visível com barras pretas quando necessário, inclusive nos layouts com destaque superior.

O layout recalcula as divisões dos painéis para maximizar a área visível dos vídeos; por isso, painéis de uma mesma composição podem ter tamanhos diferentes quando isso aumenta o vídeo sem cortar a imagem. A otimização usa uma referência 16:9, preserva a posição central da imagem e não tenta detectar a proporção individual de cada transmissão.

O modo automático distribui os painéis conforme a quantidade: a escolha inicial fica em “Automático”, “Sem destaques” ou “Com destaques”. As miniaturas do seletor inicial mostram a composição que será aberta, com descrições como “13 telas · 1 grande + 12 pequenas”. Ao destacar um jogo (estrela do painel), ele ocupa o espaço grande e os demais se redistribuem; um segundo destaque troca automaticamente para uma composição que comporte dois. Em 13 telas com uma principal, o editor mostra quatro miniaturas de canto. Em 10 telas com duas principais, mostra as posições equivalentes agrupadas. Em 7 telas com três principais, mostra os quatro arranjos em L, identificados pelo canto das telas menores. Não há divisórias manuais; os tamanhos são recalculados automaticamente ao redimensionar a janela, preservando destaques e posições e maximizando o vídeo dentro de cada painel.

Escolher números e miniaturas altera somente a prévia. Aplicar confirma a composição inteira em uma operação de Desfazer. As miniaturas usam a proporção atual da janela e o mesmo cálculo dos painéis. Com uma ou duas telas, não há seleção de principal. Com várias principais, a posição escolhida corresponde ao grupo.

As URLs ficam em memória durante a execução. O catálogo e os players do WeddBets compartilham a sessão persistente `quadra`, de modo que o login é feito uma única vez. Outros serviços continuam sem integração ou perfil específico.

## Validações

```bash
npm test
npm run typecheck
npm run test:renderer
npm run test:toolbar
npm run test:app
npm run test:close
npm run test:packaged
```

Os testes locais cobrem cada quantidade de 1 a 16, o catálogo de composições e posições, adição progressiva de telas, preservação de rascunhos, áreas equivalentes, destaques múltiplos, os quatro cantos do layout de 13, histerese de composição, edição, ações coletivas, abertura de múltiplas páginas, fechamento e uma página com `X-Frame-Options` carregada diretamente em um painel.

O teste `test:toolbar` executa o aplicativo real com vídeos locais em reprodução, reproduz a cadeia `#app → wrapper → ViewEvento → row → coluna → player`, verifica o encaixe geométrico real dos players WeddBets em 3 e 4 telas com proporções 16:9, 4:3, 3:4 e 16:4 e exercita OpenVidu, Ant, Flash, MS, `#frameVideo`, inserção tardia, recarga, seleção de destaque, posições, modo igual, redimensionamento, tela cheia e página sem player. A validação confirma clipping nos ancestrais, proporção, centralização, uso máximo do espaço e continuidade da reprodução, além dos limites e pontos de clique da barra e das lixeiras nas 124 combinações de composição/posição. Também verifica foco nos vídeos, inatividade por mais de dez segundos, áudio coletivo, menus e retorno ao seletor. As capturas ficam em `artifacts/toolbar-checks/`.

Problemas de validação de URL, mensagens de erro de navegação, reabertura da mesma URL e perda de parâmetros em certos links do YouTube permanecem fora desta limpeza.
