import {
  analyzeInventoryLocation,
  answerInventoryQuestion,
  explainInventoryOperation,
  type IntelligenceLocationContext,
  type IntelligenceMove,
  type IntelligenceOperation,
  type IntelligenceProduct,
  type InventoryAnswer,
  type InventoryIntelligence,
} from "./inventory-intelligence";

export type InventoryQuestionContext = {
  question: string;
  products: IntelligenceProduct[];
  moves: IntelligenceMove[];
  intelligence: InventoryIntelligence;
  contextProductId?: number;
  contextOperation?: IntelligenceOperation;
  contextLocation?: IntelligenceLocationContext;
};

export interface InventoryQuestionProvider {
  readonly kind: "deterministic-rules" | "local-open-source";
  readonly label: string;
  answer(context: InventoryQuestionContext): Promise<InventoryAnswer>;
}

/**
 * The production-safe provider for this build. A future local/open-source
 * adapter can implement the same contract without changing the UI or rules.
 */
export const deterministicInventoryProvider: InventoryQuestionProvider = {
  kind: "deterministic-rules",
  label: "Deterministic inventory rules",
  async answer(context) {
    if (context.contextOperation) {
      return explainInventoryOperation(context.contextOperation);
    }
    if (context.contextLocation) {
      return analyzeInventoryLocation(
        context.contextLocation,
        context.products,
        context.moves,
      );
    }
    return answerInventoryQuestion(
      context.question,
      context.products,
      context.intelligence,
      context.contextProductId,
    );
  },
};