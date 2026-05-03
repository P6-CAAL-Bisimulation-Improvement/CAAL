
/// <reference path="./ccs.ts" />

module Equivalence {

    function getLeftContextCandidates(leftProcess: CCS.Process, bisimilarProcessPairs: [CCS.Process, CCS.Process][]): [CCS.Process, [CCS.Process, CCS.Process]][] {
        var result: [CCS.Process, [CCS.Process, CCS.Process]][] = [];

        // 1. Get all contexts of leftProcess with a hole, which is bisimilar to the first process in the bisimilarProcessPair
        bisimilarProcessPairs.forEach((bisimilarProcessPair) => {
            getContextCandidate(leftProcess, bisimilarProcessPair[0]).forEach(contextCandidate => {
                result.push([contextCandidate, bisimilarProcessPair]);
            });
        });

        return result;
    }

    function getRightContextCandidates(rightProcess: CCS.Process, bisimilarProcessPairs: [CCS.Process, CCS.Process][]): [CCS.Process, [CCS.Process, CCS.Process]][] {
        var result: [CCS.Process, [CCS.Process, CCS.Process]][] = [];

        // 1. Get all contexts of rightProcess with a hole, which is bisimilar to the second process in the bisimilarProcessPair
        bisimilarProcessPairs.forEach((bisimilarProcessPair) => {
            getContextCandidate(rightProcess, bisimilarProcessPair[1]).forEach(contextCandidate => {
                result.push([contextCandidate, bisimilarProcessPair]);
            });
        });

        return result;
    }

    function getHoleInProcess(process: CCS.Process, hole: CCS.Process, rebuild: (hole: CCS.Process) => CCS.Process): CCS.Process | undefined {
        var result: CCS.Process | undefined = undefined;

        const getHoleInProcessWithSubProcesses = <T extends { subProcesses: CCS.Process[] }>(process: T, hole: T) => {
            var resultingSubProcesses: CCS.Process[] = [];
            var holeIndex = 0;

            for (let processIndex = 0; processIndex < process.subProcesses.length; processIndex++) {
                // If the hole is found but there are still sub processes in the process
                if (holeIndex >= hole.subProcesses.length) {
                    resultingSubProcesses.push(process.subProcesses[processIndex]);
                }
                // If the current sub process is in the hole, then we go to the next sub processes for both hole and process
                else if (process.subProcesses[processIndex].id == hole.subProcesses[holeIndex].id) {
                    holeIndex++;
                }
                // Else we check the next sub process of the process
                else {
                    resultingSubProcesses.push(process.subProcesses[processIndex]);
                }
            }

            // Entire hole is not found in process, thus we cannot find a context
            if (holeIndex < hole.subProcesses.length) {
                return undefined;
            }

            resultingSubProcesses.push(new CCS.HoleProcess());
            resultingSubProcesses.sort();
            // Return sorted contex with hole
            return resultingSubProcesses;
        }

        if (process instanceof CCS.NamedProcess) {
            process = process.subProcess;
        }
        if (hole instanceof CCS.NamedProcess) {
            hole = hole.subProcess;
        }

        if (process instanceof CCS.CompositionProcess && hole instanceof CCS.CompositionProcess) {
            const subProcesses = getHoleInProcessWithSubProcesses(process, hole);
            if (subProcesses) {
                return rebuild(new CCS.CompositionProcess(subProcesses));
            }
        }
        else if (process instanceof CCS.SummationProcess && hole instanceof CCS.SummationProcess) {
            const subProcesses = getHoleInProcessWithSubProcesses(process, hole);
            if (subProcesses) {
                return rebuild(new CCS.SummationProcess(subProcesses));
            }
        }
        else if (process.id == hole.id) {
            const ctx: CCS.Process = rebuild(new CCS.HoleProcess());
            return ctx;
        }
    }

    function getContextCandidate(process: CCS.Process, hole: CCS.Process): CCS.Process[] {
        const seen: string[] = [];
        const results: CCS.Process[] = [];

        const getContextCandidatesRecursively = (node: CCS.Process, rebuild: (hole: CCS.Process) => CCS.Process): void => {
            const ctxCandidate = getHoleInProcess(node, hole, rebuild);

            if (ctxCandidate) {
                const key: string = ctxCandidate.id;
                if (seen.indexOf(key) == -1) {
                    seen.push(key);
                    results.push(ctxCandidate);
                }
            }

            node.dispatchOn<void>({
                dispatchNullProcess(n: CCS.NullProcess): void { },

                dispatchNamedProcess(n: CCS.NamedProcess): void { },

                dispatchSummationProcess(n: CCS.SummationProcess): void {
                    for (let i = 0; i < n.subProcesses.length; i++) {
                        getContextCandidatesRecursively(n.subProcesses[i], hole => {
                            const next: CCS.Process[] = n.subProcesses.slice();
                            next[i] = hole;
                            return rebuild(new CCS.SummationProcess(next));
                        });
                    }
                },

                dispatchCompositionProcess(n: CCS.CompositionProcess): void {
                    for (let i = 0; i < n.subProcesses.length; i++) {
                        getContextCandidatesRecursively(n.subProcesses[i], hole => {
                            const next: CCS.Process[] = n.subProcesses.slice();
                            next[i] = hole;
                            return rebuild(new CCS.CompositionProcess(next));
                        });
                    }
                },

                dispatchActionPrefixProcess(n: CCS.ActionPrefixProcess): void {
                    getContextCandidatesRecursively(n.nextProcess, hole =>
                        rebuild(new CCS.ActionPrefixProcess(n.action, hole))
                    );
                },

                dispatchRestrictionProcess(n: CCS.RestrictionProcess): void {
                    getContextCandidatesRecursively(n.subProcess, hole =>
                        rebuild(new CCS.RestrictionProcess(hole, n.restrictedLabels))
                    );
                },

                dispatchRelabellingProcess(n: CCS.RelabellingProcess): void {
                    getContextCandidatesRecursively(n.subProcess, hole =>
                        rebuild(new CCS.RelabellingProcess(hole, n.relabellings))
                    );
                },
            });
        }

        getContextCandidatesRecursively(process, x => x);
        return results;
    }

    export function GetBackEdgePairThroughUpToContext(leftProcess: CCS.Process, rightProcess: CCS.Process, discoveredPairs: [CCS.Process, CCS.Process][]): [CCS.Process, CCS.Process] | undefined {
        // 1. Find the resulting context candidates of each pair of holes
        const leftContexts = getLeftContextCandidates(leftProcess, discoveredPairs);
        const rightContexts = getRightContextCandidates(rightProcess, discoveredPairs);

        // 2. If matching context candidates are found, using the same process pair, then the processes are bisimilar up to context.
        for (const leftContext of leftContexts) {
            for (const rightContext of rightContexts) {
                const hasSameProcessPair: boolean = leftContext[1] === rightContext[1];
                if (hasSameProcessPair) {
                    const hasSameContext = leftContext[0].id === rightContext[0].id;
                    if (hasSameContext) {
                        // return the process pair for which the context candidates are bisimilar
                        return leftContext[1];
                    }
                }
            }
        }
        return undefined;
    }
}