const LICHESS_TOKEN = import.meta.env.VITE_LICHESS_TOKEN

// Configuration: Matches your Python pool setup
const POOL_SIZE = 2 
const enginePool = []
const taskQueue = []
let globalAnalysisId = 0

/**
 * Initializes the pool of Stockfish worker pairs concurrently
 */
export async function startEngine() {
    const initializationPromises = []

    for (let i = 0; i < POOL_SIZE; i++) {
        const instance = {
            id: i,
            sf: new Worker('/stockfish/stockfish-17.1-lite-single.js'),
            sf11: new Worker('/stockfish/stockfish.js'),
            busy: false,
            currentAnalysisId: 0
        }
        enginePool.push(instance)

        const initInstance = new Promise((resolveInstance) => {
            let sfReady = false
            let sf11Ready = false

            const checkReady = () => {
                if (sfReady && sf11Ready) resolveInstance()
            }

            // Initialize Stockfish 18 Slot
            const onMessage = (e) => {
                const msg = e.data
                if (msg === "uciok") {
                    instance.sf.postMessage("setoption name MultiPV value 3")
                    instance.sf.postMessage("isready")
                }
                if (msg === "readyok") {
                    instance.sf.removeEventListener("message", onMessage)
                    sfReady = true
                    checkReady()
                }
            }
            instance.sf.addEventListener("message", onMessage)
            instance.sf.postMessage("uci")

            // Initialize Stockfish 11 Slot
            const onMessage11 = (e) => {
                const msg = e.data
                if (msg === "uciok") {
                    instance.sf11.postMessage("isready")
                }
                if (msg === "readyok") {
                    instance.sf11.removeEventListener("message", onMessage11)
                    sf11Ready = true
                    checkReady()
                }
            }
            instance.sf11.addEventListener("message", onMessage11)
            instance.sf11.postMessage("uci")
        })

        initializationPromises.push(initInstance)
    }

    await Promise.all(initializationPromises)
}

/**
 * Halts all current worker calculations and clears out the pending queue
 */
export function cancelAnalysis() {
    globalAnalysisId++
    taskQueue.length = 0 // Clear pending tasks immediately

    const stopPromises = enginePool.map((instance) => {
        instance.sf.onmessage = null
        instance.sf11.onmessage = null
        instance.busy = false

        return new Promise((resolve) => {
            const absorber = (e) => {
                if (typeof e.data === 'string' && e.data.startsWith('bestmove')) {
                    instance.sf.removeEventListener('message', absorber)
                    instance.sf11.removeEventListener('message', absorber)
                    resolve()
                }
            }
            instance.sf.addEventListener('message', absorber)
            instance.sf.postMessage('stop')
            instance.sf11.addEventListener('message', absorber)
            instance.sf11.postMessage('stop')
            
            setTimeout(() => {
                instance.sf.removeEventListener('message', absorber)
                instance.sf11.removeEventListener('message', absorber)   
                resolve()
            }, 100)
        })
    })

    return Promise.all(stopPromises)
}

/**
 * Handles communication with Lichess Opening Book API
 */
async function isBookMove(movesList, move) {
    const bookList = movesList.join(",")
    const url = bookList 
        ? `https://explorer.lichess.ovh/masters?play=${bookList}`
        : `https://explorer.lichess.ovh/masters`

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${LICHESS_TOKEN}`,
                'Accept': 'application/json'
            }
        })
        if (!response.ok) return false
        
        const data = await response.json()
        return data.moves ? data.moves.some(m => m.uci === move) : false
    } catch (error) {
        console.warn("Lichess book API fetch failed:", error)
        return false
    }
}

/**
 * Runs localized instance analysis for a specific position
 */
function analyzePosition(instance, moves, depth, globalId, onUpdate = null, runsf11 = false) {
    const localAnalysisId = ++instance.currentAnalysisId

    return new Promise((resolve) => {
        let topMoves = [], evaluation = null, best11 = null
        const isBlackToMove = moves.length % 2 === 1

        instance.sf11.onmessage = (i) => {
            if (globalAnalysisId !== globalId || instance.currentAnalysisId !== localAnalysisId) return
            const msg11 = i.data
            if (msg11.startsWith('bestmove')) {
                const m = msg11.match(/bestmove\s+(\S+)/)
                if (m) best11 = m[1]
            }
        }

        instance.sf.onmessage = (e) => {
            if (globalAnalysisId !== globalId || instance.currentAnalysisId !== localAnalysisId) return
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
                const hasOnlyOneLine = mpNum === 1 && topMoves.length < 2
                const hasOnlyTwoLines = mpNum === 2 && topMoves.length < 3

                if (onUpdate && evaluation && currentDepth >= 10 && (mpNum === 3 || hasOnlyOneLine || hasOnlyTwoLines)) {
                    onUpdate({ evaluation: { ...evaluation }, topMoves: [...topMoves], currentDepth })
                }
            }

            if (msg.startsWith("bestmove")) {
                instance.sf.onmessage = null
                const finish = () => {
                    instance.sf11.onmessage = null
                    resolve({ evaluation, topMoves, best11 })
                }

                if (runsf11) {
                    instance.sf11.postMessage('stop')
                    const waitForSf11 = new Promise((res) => {
                        const onSf11Stop = (i) => {
                            if (typeof i.data === 'string' && i.data.startsWith('bestmove')) {
                                instance.sf11.removeEventListener('message', onSf11Stop)
                                res()
                            }
                        }
                        instance.sf11.addEventListener('message', onSf11Stop)
                        setTimeout(() => {
                            instance.sf11.removeEventListener('message', onSf11Stop)
                            res()
                        }, 100)
                    })
                    waitForSf11.then(finish)
                } else {
                    finish()
                }
            }
        }

        instance.sf.postMessage(moves.length > 0 ? `position startpos moves ${moves.join(" ")}` : "position startpos")
        instance.sf.postMessage(`go depth ${depth}`)
        if (runsf11) {
            instance.sf11.postMessage(moves.length > 0 ? `position startpos moves ${moves.join(" ")}` : "position startpos")
            instance.sf11.postMessage(`go depth 10`)
        }
    })
}

/**
 * Public facing execution function. Adds tasks to the execution queue.
 */
export function getEvaluation(move, movesList, depth, onUpdate = null) {
    const currentTaskId = globalAnalysisId
    return new Promise((resolve, reject) => {
        taskQueue.push({
            move,
            movesList,
            depth,
            onUpdate,
            globalId: currentTaskId,
            resolve,
            reject
        })
        processQueue()
    })
}

/**
 * Queue Orchestrator: Finds an idle engine pair and assigns the task
 */
async function processQueue() {
    if (taskQueue.length === 0) return

    // Find the first available instance that is not busy
    const availableInstance = enginePool.find(instance => !instance.busy)
    if (!availableInstance) return // All workers busy; wait for one to finish

    const task = taskQueue.shift()
    
    // Discard task if a cancellation occurred while it was sitting in queue
    if (task.globalId !== globalAnalysisId) {
        task.resolve(null)
        processQueue()
        return
    }

    availableInstance.busy = true
    executeTask(availableInstance, task)
}

/**
 * Processes game evaluation logic using a checked-out engine instance
 */
async function executeTask(instance, task) {
    const { move, movesList, depth, onUpdate, globalId, resolve } = task

    try {
        const [isBook, before] = await Promise.all([
            isBookMove(movesList, move),
            analyzePosition(instance, movesList, 10, globalId, null, true)
        ])

        if (globalAnalysisId !== globalId || !before) {
            instance.busy = false
            resolve(null)
            processQueue()
            return
        }

        const eval_before = before.evaluation
        const top_moves = before.topMoves || []
        const best11 = before.best11 ?? null       
        const best_move = top_moves[0]?.Move ?? ""
        const second_best_eval = top_moves.length >= 2
            ? (top_moves[1]?.Centipawn ?? 0)
            : (top_moves[0]?.Centipawn ?? 0)

        const afterMoves = move ? [...movesList, move] : movesList
        const side_to_move = afterMoves.length % 2 === 1 ? "w" : "b"

        function buildResult(eval_after, topMovesAfter, currentDepth) {
            const best_line = topMovesAfter[0]?.line ?? []
            const excellent_line = topMovesAfter[1]?.line ?? []
            const third_line = topMovesAfter[2]?.line ?? []
            let loss = 0, brilliant_loss = 0

            if (eval_before?.type === "cp" && eval_after?.type === "cp") {
                if (side_to_move === "w") {
                    loss = eval_before.value - eval_after.value
                    brilliant_loss = eval_after.value - second_best_eval
                } else {
                    loss = eval_after.value - eval_before.value
                    brilliant_loss = second_best_eval - eval_after.value
                }
                loss = Math.max(0, loss)
            }

            let accuracy = "none"
            if (move) {
                if (isBook) {
                    accuracy = "book"
                } else if (best_move === move && top_moves.length >= 2 && brilliant_loss > 150 && best11 !== null  && best11 !== best_move) {
                    accuracy = "brilliant"
                } else if (best_move === move && top_moves.length >= 2 && brilliant_loss > 150) {
                    accuracy = "great"
                } else if (best_move == move || loss < 15) {
                    accuracy = "best"
                } else if (loss < 40) {
                    accuracy = "excellent"
                } else if (loss < 80) {
                    accuracy = "good"
                } else if (loss < 150) {
                    accuracy = "inaccuracy"
                } else if (loss < 300) {
                    accuracy = "mistake"
                } else {
                    accuracy = "blunder"
                }
            }

            const moverIsWhite = side_to_move === "w"

            if (eval_after?.type === "mate") {
                const moverDeliversMate = moverIsWhite ? eval_after.value > 0 : eval_after.value < 0

                if (moverDeliversMate) {
                    if (best_move === move && top_moves.length >= 2 && top_moves[1]?.score?.type !== "mate") {
                        accuracy = (best11 !== null && best11 !== best_move) ? "brilliant" : "great"
                    }
                } else if (eval_before?.type === "cp") {
                    const alreadyLostBig = moverIsWhite ? eval_before.value <= -700 : eval_before.value >= 700
                    const alreadyLostModerate = moverIsWhite ? eval_before.value <= -400 : eval_before.value >= 400

                    if (alreadyLostBig) {
                        accuracy = "inaccuracy"
                    } else if (alreadyLostModerate) {
                        accuracy = "mistake"
                    } else {
                        accuracy = "blunder"
                    }
                }
            }

            if (side_to_move === "b") {
                if (eval_before?.type === "mate" && eval_after?.type === "cp") {
                    if (eval_before.value < 0 && eval_after.value <= -700) {
                        accuracy = "inaccuracy"
                    } else if (eval_before.value < 0 && eval_after.value > -700 && eval_after.value <= -400) {
                        accuracy = "mistake"
                    } else {
                        accuracy = "blunder"
                    }
                }
                if (eval_before?.value <= -800 && eval_after?.value <= -300 && eval_after?.value >= -600) {
                    accuracy = "mistake"
                } else if (eval_before?.value <= -800 && eval_after?.value > eval_before?.value + 150 && eval_after?.value <= -600) {
                    accuracy = "inaccuracy"
                }
            }

            if (side_to_move === "w") {
                if (eval_before?.type === "mate" && eval_after?.type === "cp") {
                    if (eval_before.value > 0 && eval_after.value >= 700) {
                        accuracy = "inaccuracy"
                    } else if (eval_before.value > 0 && eval_after.value >= 400 && eval_after.value < 700) {
                        accuracy = "mistake"
                    } else {
                        accuracy = "blunder"
                    }
                }
                if (eval_before?.value >= 800 && eval_after?.value >= 300 && eval_after?.value <= 600) {
                    accuracy = "mistake"
                } else if (eval_before?.value >= 800 && eval_after?.value < eval_before?.value - 150 && eval_after?.value >= 600) {
                    accuracy = "inaccuracy"
                }
            }

            if (eval_before?.type === "mate" && eval_after?.type === "mate") {
                const hadMate = moverIsWhite ? eval_before.value > 0 : eval_before.value < 0
                const hasMate = moverIsWhite ? eval_after.value > 0 : eval_after.value < 0

                if (hadMate && !hasMate) {
                    accuracy = "blunder"
                } else if (!hadMate && hasMate) {
                    accuracy = "great"
                }
            }   

            return {
                depth: currentDepth,
                move_played: move,
                best_move,
                eval: eval_after,
                excellent_eval: topMovesAfter[1]?.Centipawn ?? null,
                third_eval: topMovesAfter[2]?.Centipawn ?? null,
                move_accuracy: accuracy,
                best_line,
                excellent_line,
                third_line,
                moves_list: afterMoves,
            }
        }

        const afterFinal = await analyzePosition(
            instance,
            afterMoves,
            depth,
            globalId,
            onUpdate ? (data) => onUpdate(buildResult(data.evaluation, data.topMoves, data.currentDepth)) : null
        )

        instance.busy = false

        if (globalAnalysisId !== globalId || !afterFinal) {
            resolve(null)
        } else {
            resolve(buildResult(afterFinal.evaluation, afterFinal.topMoves, depth))
        }

    } catch (err) {
        console.error("Task execution failed: ", err)
        instance.busy = false
        resolve(null)
    } finally {
        processQueue() // Pick up next element in line immediately
    }
}