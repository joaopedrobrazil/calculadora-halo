# Calculadora HALO

App web (instalável no celular) para calcular o **Ponto de Saída (PS)** de um salto livre HALO a partir do **Ponto de Impacto Desejado (PID)**, dos ventos por camada e da velocidade de lançamento da aeronave. Mostra o PS no mapa e, com o GPS do celular, o tempo e a distância até ele.

> Ferramenta de apoio e estudo. As constantes K são médias e o resultado depende dos ventos informados. Não substitui o cálculo e a decisão do Mestre de Salto.

## Como usar

1. **Antes do voo, com internet:** abra o app e marque o PID (toque em *Marcar PID no mapa*, use *PID na minha posição* ou digite as coordenadas na aba *Salto*).
2. **Deixe o mapa guardado:** navegue pela região do salto, aproximando e afastando o zoom. O app guarda os pedaços de mapa vistos para usar sem internet.
3. **Ajuste os dados do salto** na aba *Salto*: altitudes, constantes K, velocidade de lançamento (padrão 120 kt) e proa.
4. **No avião:** preencha os ventos na aba *Ventos*. O PS aparece no mapa na hora.
5. **Navegação:** na aba *Navegação*, ligue o GPS para ver o tempo até o PS, a distância no eixo e o desvio lateral.

Para instalar: no Android (Chrome), menu ⋮ → *Instalar app*. No iPhone (Safari), botão Compartilhar → *Adicionar à Tela de Início*.

## Cálculo

Soma vetorial camada por camada:

```
D = K × V × A          (m; V em nós, A em milhares de pés)
X = D × sen(direção)   (leste +)
Y = D × cos(direção)   (norte +)
PS = (ΣX, ΣY) − projeção à frente ao longo da proa
```

- **Direção** é a de onde o vento vem; por isso o PS fica contra o vento em relação ao PID.
- **Queda livre** (K padrão 3) vai da saída à abertura; **velame aberto** (K padrão 25) vai da abertura ao início do tráfego (padrão 1.000 ft).
- Cada leitura de vento vale até a metade da distância às leituras vizinhas (com leituras a cada 2.000 ft, cada uma cobre ±1.000 ft).
- **Projeção à frente** = velocidade verdadeira na altitude de saída (IAS + 2% por 1.000 ft) × tempo informado (padrão 3 s; ajuste pela tabela da aeronave).
- **Proa automática:** o eixo de aproximação aponta do PS para o PID, passando pelo fim da projeção à frente. Também é possível informar uma proa manual.
- Coordenadas do PS em graus decimais, graus-minutos-segundos e UTM (WGS 84 ≈ SIRGAS 2000).

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `index.html` | Interface |
| `js/calc.js` | Cálculo (sem dependências) |
| `js/app.js` | Mapa, GPS e interface |
| `sw.js` | Funcionamento offline |
| `vendor/leaflet/` | Biblioteca de mapas [Leaflet](https://leafletjs.com) 1.9.4 (licença BSD-2) |

O mapa abre em **satélite** (com nomes de lugares) para dar noção real do terreno em volta do PS; dá para trocar para mapa de ruas no botão de camadas.

Imagens de satélite © Esri; mapa de ruas © colaboradores do OpenStreetMap.

## Publicação

GitHub Pages: *Settings → Pages → Deploy from a branch → `main` / `(root)`*.
