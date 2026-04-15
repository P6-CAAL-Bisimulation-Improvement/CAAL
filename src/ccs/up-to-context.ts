
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

    export function GetPairsWhichDeterminBisimilarityOnly(leftProcess: CCS.Process, rightProcess: CCS.Process): [CCS.Process, CCS.Process][] {
        let results: [CCS.Process, CCS.Process][] = [];

        const getNormalNotNamed = (process: CCS.Process): CCS.Process => {
            if (process instanceof CCS.NamedProcess) {
                return getNormalFormFromProcess(process.subProcess);
            }
            else {
                return getNormalFormFromProcess(process);
            }
        }

        const leftNormalForm = getNormalNotNamed(leftProcess);
        const rightNormalForm = getNormalNotNamed(rightProcess);

        // Assuming that the processes are in normal form, we want to traverse the "tree" of the processes from the root to the leaves, and find the "deepest" spot at which the trees differ.
        
        // This will result in a list of a pairs of processes with the redundant context removed, where the pair of processes may already be in the graph, and are thereby a back edge pair.
        const getPairsWhichDeterminBisimilarityOnlyRecursively = (leftProcess: CCS.Process, rightProcess: CCS.Process): void => {
            // If processes is of different types
            if (leftProcess.constructor !== rightProcess.constructor) {
                results.push([leftProcess, rightProcess]);
            }
            else if (leftProcess instanceof CCS.NamedProcess && rightProcess instanceof CCS.NamedProcess) {
                if (leftProcess.id != rightProcess.id) {
                    results.push([leftProcess, rightProcess]);
                }
                else { 
                    return;
                }
            }
            else if (leftProcess instanceof CCS.SummationProcess && rightProcess instanceof CCS.SummationProcess) {
                // it may differ only in some of the subprocesses, we want to find the subprocesses which result in the largest common context, which is the smallest pair of processes that differ, then return a new summation process with only those differing subprocesses.
                const [leftDiff, rightDiff] = symmetricMultisetDiff(leftProcess.subProcesses, rightProcess.subProcesses, (x, y) => x.id.localeCompare(y.id));
                if (leftDiff.length == 0 && rightDiff.length > 0) {
                    results.push([new CCS.CompositionProcess(leftProcess.subProcesses), new CCS.CompositionProcess(rightDiff)]);
                }
                else if (rightDiff.length == 0 && leftDiff.length > 0) {
                    results.push([new CCS.CompositionProcess(leftDiff), new CCS.CompositionProcess(rightProcess.subProcesses)]);
                }
                else if (leftDiff.length == 0 && rightDiff.length == 0) {
                    for (let i = 0; i < leftProcess.subProcesses.length; i++) {
                        getPairsWhichDeterminBisimilarityOnlyRecursively(leftProcess.subProcesses[i], rightProcess.subProcesses[i]);
                    }
                }
                else {
                    results.push([new CCS.CompositionProcess(leftDiff), new CCS.CompositionProcess(rightDiff)]);
                }
            }
            else if (leftProcess instanceof CCS.CompositionProcess && rightProcess instanceof CCS.CompositionProcess) {
                const [leftDiff, rightDiff] = symmetricMultisetDiff(leftProcess.subProcesses, rightProcess.subProcesses, (x, y) => x.id.localeCompare(y.id));
                if (leftDiff.length == 0 && rightDiff.length > 0) {
                    results.push([new CCS.CompositionProcess(leftProcess.subProcesses), new CCS.CompositionProcess(rightDiff)]);
                }
                else if (rightDiff.length == 0 && leftDiff.length > 0) {
                    results.push([new CCS.CompositionProcess(leftDiff), new CCS.CompositionProcess(rightProcess.subProcesses)]);
                }
                else if (leftDiff.length == 0 && rightDiff.length == 0) {
                    for (let i = 0; i < leftProcess.subProcesses.length; i++) {
                        getPairsWhichDeterminBisimilarityOnlyRecursively(leftProcess.subProcesses[i], rightProcess.subProcesses[i]);
                    }
                }
                else {
                    results.push([new CCS.CompositionProcess(leftDiff), new CCS.CompositionProcess(rightDiff)]);
                }
            }
            else if (leftProcess instanceof CCS.ActionPrefixProcess && rightProcess instanceof CCS.ActionPrefixProcess) {
                if (leftProcess.action != rightProcess.action) {
                    results.push([leftProcess, rightProcess]);
                }
                else {
                    getPairsWhichDeterminBisimilarityOnlyRecursively(leftProcess.nextProcess, rightProcess.nextProcess);
                }
            }
            else if (leftProcess instanceof CCS.RestrictionProcess && rightProcess instanceof CCS.RestrictionProcess) {
                const [leftDiff, rightDiff] = symmetricMultisetDiff(leftProcess.restrictedLabels.toArray(), rightProcess.restrictedLabels.toArray(), (x, y) => x.localeCompare(y));
                if (leftDiff.length == 0 && rightDiff.length > 0) {
                    results.push([new CCS.RestrictionProcess(leftProcess.subProcess, leftProcess.restrictedLabels), new CCS.RestrictionProcess(rightProcess.subProcess, new CCS.LabelSet(rightDiff))]);
                }
                else if (rightDiff.length == 0 && leftDiff.length > 0) {
                    results.push([new CCS.RestrictionProcess(leftProcess.subProcess, new CCS.LabelSet(leftDiff)), new CCS.RestrictionProcess(rightProcess.subProcess, rightProcess.restrictedLabels)]);
                }
                else if (leftDiff.length == 0 && rightDiff.length == 0) {
                    getPairsWhichDeterminBisimilarityOnlyRecursively(leftProcess.subProcess, rightProcess.subProcess);
                }
                else {
                    results.push([new CCS.RestrictionProcess(leftProcess.subProcess, new CCS.LabelSet(leftDiff)), new CCS.RestrictionProcess(rightProcess.subProcess, new CCS.LabelSet(rightDiff))]);
                }
            }
            else if (leftProcess instanceof CCS.RelabellingProcess && rightProcess instanceof CCS.RelabellingProcess) {
                const [leftDiff, rightDiff] = symmetricMultisetDiff(leftProcess.relabellings.toArray(), rightProcess.relabellings.toArray(), (x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
                if (leftDiff.length == 0 && rightDiff.length > 0) {
                    results.push([new CCS.RelabellingProcess(leftProcess.subProcess, leftProcess.relabellings), new CCS.RelabellingProcess(rightProcess.subProcess, new CCS.RelabellingSet(rightDiff))]);
                }
                else if (rightDiff.length == 0 && leftDiff.length > 0) {
                    results.push([new CCS.RelabellingProcess(leftProcess.subProcess, new CCS.RelabellingSet(leftDiff)), new CCS.RelabellingProcess(rightProcess.subProcess, rightProcess.relabellings)]);
                }
                else if (leftDiff.length == 0 && rightDiff.length == 0) {
                    getPairsWhichDeterminBisimilarityOnlyRecursively(leftProcess.subProcess, rightProcess.subProcess);
                }
                else {
                    results.push([new CCS.RelabellingProcess(leftProcess.subProcess, new CCS.RelabellingSet(leftDiff)), new CCS.RelabellingProcess(rightProcess.subProcess, new CCS.RelabellingSet(rightDiff))]);
                }
            }
        };

        getPairsWhichDeterminBisimilarityOnlyRecursively(leftNormalForm, rightNormalForm);
        return results;
    }
    

    function getNormalFormFromProcess(process: CCS.Process): CCS.Process {
        const getSubProcessesInNormalForm = <T extends { subProcesses: CCS.Process[] }>(process: T) => {
            var newSubProcesses: CCS.Process[] = [];

            // Change all subprocesses to normal form
            process.subProcesses.forEach((subProcess) => {
                var normalFormSubProcess = getNormalFormFromProcess(subProcess);
                newSubProcesses.push(normalFormSubProcess);
            });
            
            return newSubProcesses;
        };

        var normalFormProcess: CCS.Process = process;
        process.dispatchOn<void>({
            dispatchNullProcess(n: CCS.NullProcess): void { },
            
            dispatchNamedProcess(n: CCS.NamedProcess): void { },
            
            dispatchSummationProcess(n: CCS.SummationProcess): void {
                var normalFormSubprocesses: CCS.Process[] = getSubProcessesInNormalForm(n);

                var newSubProcesses: CCS.Process[] = [];
                normalFormSubprocesses.forEach(subProcess => {
                    // Null element: P + 0 => P
                    if (subProcess instanceof CCS.NullProcess) {
                        return;
                    }
                    // Idempotence: P + P => P
                    else if (newSubProcesses.indexOf(subProcess) > -1) { //Includes
                        return;
                    }
                    // Flatten: P + (Q + R) => P + Q + R
                    else if (subProcess instanceof CCS.SummationProcess) {
                        subProcess.subProcesses.forEach(nested => {
                            newSubProcesses.push(nested);
                        });
                    }
                    else {
                        newSubProcesses.push(subProcess);
                    }
                });
                // Symmetry: P + Q => Q + P, order by id
                newSubProcesses.sort();
                normalFormProcess = new CCS.SummationProcess(newSubProcesses);
            },
            
            dispatchCompositionProcess(n: CCS.CompositionProcess): void { 
                var normalFormSubprocesses: CCS.Process[] = getSubProcessesInNormalForm(n);

                var newSubProcesses: CCS.Process[] = [];
                normalFormSubprocesses.forEach(subProcess => {
                    // Null element: P | 0 => P
                    if (subProcess instanceof CCS.NullProcess) {
                        return;
                    }
                    // Idempotence is not valid for compositions 
                    // Flatten: P | (Q | R) => P | Q | R
                    else if (subProcess instanceof CCS.CompositionProcess) {
                        subProcess.subProcesses.forEach(nested => {
                            newSubProcesses.push(nested);
                        });
                    }
                    else {
                        newSubProcesses.push(subProcess);
                    }
                });
                // Symmetry: P | Q => Q | P, order by id
                newSubProcesses.sort();
                normalFormProcess = new CCS.CompositionProcess(newSubProcesses);
            },
            
            dispatchActionPrefixProcess(n: CCS.ActionPrefixProcess): void { 
                normalFormProcess = new CCS.ActionPrefixProcess(n.action, getNormalFormFromProcess(n.nextProcess));
            },
            
            dispatchRestrictionProcess(n: CCS.RestrictionProcess): void { 
                normalFormProcess = new CCS.RestrictionProcess(getNormalFormFromProcess(n.subProcess), n.restrictedLabels);
            },
            
            dispatchRelabellingProcess(n: CCS.RelabellingProcess): void { 
                normalFormProcess = new CCS.RelabellingProcess(getNormalFormFromProcess(n.subProcess), n.relabellings);
            },
        });

        return normalFormProcess;
    }
    
    function symmetricMultisetDiff<T>(
        a: T[],
        b: T[],
        compare: (x: T, y: T) => number
    ): [onlyInA: T[], onlyInB: T[]] {
        // asssumes x, y is already sorted according to compare function, duplicates are allowed
        const onlyInA: T[] = [];
        const onlyInB: T[] = [];
        let i = 0, j = 0;

        while (i < a.length && j < b.length) {
            const cmp = compare(a[i], b[j]);

            if (cmp < 0) {
                onlyInA.push(a[i++]);
            } else if (cmp > 0) {
                onlyInB.push(b[j++]);
            } else {
                i++;
                j++;
            }
        }

        while (i < a.length) onlyInA.push(a[i++]);
        while (j < b.length) onlyInB.push(b[j++]);

        return [onlyInA, onlyInB];
    }
}