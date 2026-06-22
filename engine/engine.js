let sf = null
let analysisId = 0
let currentResolve = null

import { Chess } from 'chess.js'

const chess = new Chess()

export async function startEngine() {
    return new Promise((resolve) => {
        sf = new Worker('/stockfish/stockfish-17.1-lite-single.js')
        const onMessage = (e) => {
            const msg = e.data
            if (msg === "uciok") {
                sf.postMessage("setoption name MultiPV value 2")
                sf.postMessage("isready")
            }
            if (msg === "readyok") {
                sf.removeEventListener("message", onMessage)
                resolve()
            }
        }
        sf.addEventListener("message", onMessage)
        sf.postMessage("uci")
    })
}

// Stop current analysis cleanly — await this before starting a new one
export function cancelAnalysis() {
    analysisId++

    // Unblock any pending analyzePosition Promise
    if (currentResolve) {
        currentResolve(null)
        currentResolve = null
    }

    sf.onmessage = null

    return new Promise((resolve) => {
        // Absorb the bestmove Stockfish sends in response to stop
        const absorber = (e) => {
            if (typeof e.data === 'string' && e.data.startsWith('bestmove')) {
                sf.removeEventListener('message', absorber)
                resolve()
            }
        }
        sf.addEventListener('message', absorber)
        sf.postMessage('stop')
        // Safety fallback if engine was idle and sends no bestmove
        setTimeout(() => { sf.removeEventListener('message', absorber); resolve() }, 100)
    })
}

function analyzePosition(moves, depth, onUpdate = null) {
    const myId = analysisId

    return new Promise((resolve) => {
        currentResolve = resolve
        let topMoves = [], evaluation = null
        const isBlackToMove = moves.length % 2 === 1

        sf.onmessage = (e) => {
            if (analysisId !== myId) return

            const msg = e.data

            if (msg.includes("score") && msg.includes("pv")) {
                const mp = msg.match(/multipv (\d+)/)
                const depthMatch = msg.match(/\bdepth (\d+)\b/)
                const cp = msg.match(/score cp (-?\d+)/)
                const mate = msg.match(/score mate (-?\d+)/)
                const pv = msg.match(/ pv (.+)/)

                if (!pv) return

                let score = cp
                    ? { type: "cp", value: parseInt(cp[1]) }
                    : mate ? { type: "mate", value: parseInt(mate[1]) } : null

                if (!score) return
                if (isBlackToMove) score.value = -score.value

                const info = {
                    Move: pv[1].split(" ")[0],
                    Centipawn: score.type === "cp" ? score.value : null,
                    score,
                    line: pv[1].split(" ")
                }

                if (!mp || mp[1] === "1") evaluation = score
                if (mp) topMoves[parseInt(mp[1]) - 1] = info

                const mpNum = mp ? parseInt(mp[1]) : 1
                const currentDepth = depthMatch ? parseInt(depthMatch[1]) : 0
                if (onUpdate && mpNum === 2 && evaluation && currentDepth >= 10) {
                    onUpdate({ evaluation: { ...evaluation }, topMoves: [...topMoves], currentDepth })
                }
            }

            if (msg.startsWith("bestmove")) {
                sf.onmessage = null
                currentResolve = null
                resolve({ evaluation, topMoves })
            }
        }

        sf.postMessage(moves.length > 0 ? `position startpos moves ${moves.join(" ")}` : "position startpos")
        sf.postMessage(`go depth ${depth}`)
    })
}

export async function getEvaluation(move, movesList, depth, onUpdate = null) {
    const myId = analysisId

    // Before: run at lower depth for fast response — depth 12 is enough for accuracy classification
    const before = await analyzePosition(movesList, 12)
    if (analysisId !== myId || !before) return null

    const eval_before = before.evaluation
    const top_moves = before.topMoves || []
    const best_move = top_moves[0]?.Move ?? ""
    const second_best_eval = top_moves.length >= 2
        ? (top_moves[1]?.Centipawn ?? 0)
        : (top_moves[0]?.Centipawn ?? 0)

    const afterMoves = [...movesList, move]
    const side_to_move = afterMoves.length % 2 === 1 ? "w" : "b"

    function buildResult(eval_after, topMovesAfter, currentDepth) {
        const best_line = topMovesAfter[0]?.line ?? []
        const excellent_line = topMovesAfter[1]?.line ?? []
        let loss = 0, brilliant_loss = 0

        if (eval_before?.type === "cp" && eval_after?.type === "cp") {
            if (side_to_move === "w") {
                loss = eval_before.value - eval_after.value
                brilliant_loss = eval_before.value - second_best_eval
            } else {
                loss = eval_after.value - eval_before.value
                brilliant_loss = second_best_eval - eval_before.value
            }
            loss = Math.max(0, loss)
        }

        let accuracy = "none"
        if (move) {
            if (best_move === move && top_moves.length === 2 && brilliant_loss > 150) accuracy = "great"
            else if (loss < 15)  accuracy = "best"
            else if (loss < 40)  accuracy = "excellent"
            else if (loss < 80)  accuracy = "good"
            else if (loss < 150) accuracy = "inaccuracy"
            else if (loss < 300) accuracy = "mistake"
            else accuracy = "blunder"
        }
        if (eval_before?.type === "cp" && eval_after?.type === "mate") accuracy = "blunder"

        return {
            depth: currentDepth,
            move_played: move,
            best_move,
            eval: eval_after,
            excellent_eval: topMovesAfter[1]?.Centipawn ?? null,
            move_accuracy: accuracy,
            best_line,
            excellent_line,
            moves_list: afterMoves
        }
    }

    const afterFinal = await analyzePosition(
        afterMoves,
        depth,
        onUpdate ? (data) => onUpdate(buildResult(data.evaluation, data.topMoves, data.currentDepth)) : null
    )
    if (!afterFinal) return null

    return buildResult(afterFinal.evaluation, afterFinal.topMoves, depth)
}