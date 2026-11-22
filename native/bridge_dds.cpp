// Flat C entry points over the DDS legacy API, so JavaScript only has to
// pass strings and int buffers.

#include <cstring>

#include <api/dds_data_types.hpp>
#include <api/dll.h>
#include <emscripten.h>

namespace {

void copy_pbn(char* dst, std::size_t size, const char* src)
{
    std::strncpy(dst, src, size - 1);
    dst[size - 1] = '\0';
}

void write_par(const ParResultsMaster& par, int* out)
{
    out[0] = par.score;
    out[1] = par.number;
    for (int i = 0; i < par.number && i < 10; ++i) {
        const ContractType& c = par.contracts[i];
        int* o = out + 2 + 5 * i;
        o[0] = c.level;
        o[1] = c.denom;
        o[2] = c.seats;
        o[3] = c.under_tricks;
        o[4] = c.over_tricks;
    }
}

} // namespace

extern "C" {

// out[20]: tricks as res_table[strain][hand], strains S,H,D,C,NT, hands N,E,S,W.
EMSCRIPTEN_KEEPALIVE int bdw_calc_table(const char* pbn, int* out)
{
    DdTableDealPBN deal{};
    copy_pbn(deal.cards, sizeof(deal.cards), pbn);
    DdTableResults table{};
    const int rc = CalcDDtablePBN(deal, &table);
    if (rc != RETURN_NO_FAULT) return rc;
    std::memcpy(out, table.res_table, sizeof(table.res_table));
    return rc;
}

// out: score (NS view), count, then count x (level, denom, seats, under, over).
EMSCRIPTEN_KEEPALIVE int bdw_dealer_par(const int* table, int dealer, int vulnerable, int* out)
{
    DdTableResults t{};
    std::memcpy(t.res_table, table, sizeof(t.res_table));
    ParResultsMaster par{};
    const int rc = DealerParBin(&t, &par, dealer, vulnerable);
    if (rc != RETURN_NO_FAULT) return rc;
    write_par(par, out);
    return rc;
}

// out: two dealer_par blocks of 52 ints, NS starting the bidding then EW.
EMSCRIPTEN_KEEPALIVE int bdw_sides_par(const int* table, int vulnerable, int* out)
{
    DdTableResults t{};
    std::memcpy(t.res_table, table, sizeof(t.res_table));
    ParResultsMaster sides[2]{};
    const int rc = SidesParBin(&t, sides, vulnerable);
    if (rc != RETURN_NO_FAULT) return rc;
    write_par(sides[0], out);
    write_par(sides[1], out + 52);
    return rc;
}

// trick: up to three cards already played, as (suit, rank) pairs, rank 0 = empty.
// out: nodes, cards, then cards x (suit, rank, equals, score).
EMSCRIPTEN_KEEPALIVE int bdw_solve_board(
    const char* pbn, int trump, int first, const int* trick,
    int target, int solutions, int mode, int* out)
{
    DealPBN deal{};
    deal.trump = trump;
    deal.first = first;
    for (int i = 0; i < 3; ++i) {
        deal.currentTrickSuit[i] = trick[2 * i];
        deal.currentTrickRank[i] = trick[2 * i + 1];
    }
    copy_pbn(deal.remainCards, sizeof(deal.remainCards), pbn);
    FutureTricks fut{};
    const int rc = SolveBoardPBN(deal, target, solutions, mode, &fut, 0);
    if (rc != RETURN_NO_FAULT) return rc;
    out[0] = fut.nodes;
    out[1] = fut.cards;
    for (int i = 0; i < fut.cards; ++i) {
        int* o = out + 2 + 4 * i;
        o[0] = fut.suit[i];
        o[1] = fut.rank[i];
        o[2] = fut.equals[i];
        o[3] = fut.score[i];
    }
    return rc;
}

// play: cards as "SAH2..." (suit letter, rank char). out: count, then tricks.
EMSCRIPTEN_KEEPALIVE int bdw_analyse_play(
    const char* pbn, int trump, int first, const char* play, int* out)
{
    DealPBN deal{};
    deal.trump = trump;
    deal.first = first;
    copy_pbn(deal.remainCards, sizeof(deal.remainCards), pbn);
    PlayTracePBN trace{};
    trace.number = static_cast<int>(std::strlen(play) / 2);
    copy_pbn(trace.cards, sizeof(trace.cards), play);
    SolvedPlay solved{};
    const int rc = AnalysePlayPBN(deal, trace, &solved, 0);
    if (rc != RETURN_NO_FAULT) return rc;
    out[0] = solved.number;
    for (int i = 0; i < solved.number && i < 53; ++i) out[1 + i] = solved.tricks[i];
    return rc;
}

EMSCRIPTEN_KEEPALIVE void bdw_error_message(int code, char* line)
{
    ErrorMessage(code, line);
}

}
