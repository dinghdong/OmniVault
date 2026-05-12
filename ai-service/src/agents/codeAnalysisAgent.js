import OpenAI from 'openai';
import { logger } from '../logger.js';

/**
 * CodeAnalysisAgent - Analyzes smart contract code for security and quality
 */
export class CodeAnalysisAgent {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.model = process.env.OPENAI_MODEL || 'gpt-4o';
  }

  async analyze({ sourceCodeHash, gitRepoUrl, context }) {
    logger.info(`CodeAnalysisAgent: Starting analysis`, { sourceCodeHash });

    try {
      // In production, fetch actual code from IPFS/GitHub
      const codeContext = await this._fetchCodeContext(sourceCodeHash, gitRepoUrl);

      const prompt = this._buildAnalysisPrompt(codeContext, context);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are an expert smart contract auditor specializing in Solidity security.
Analyze the provided code for:
1. Security vulnerabilities (reentrancy, overflow, access control)
2. Economic exploits (tokenomics issues, fee extraction)
3. Code quality and best practices
4.rug threats and honeypot patterns

Provide a structured analysis with severity ratings.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4000
      });

      const analysis = response.choices[0].message.content;

      // Parse the LLM response to extract structured findings
      const findings = this._parseFindings(analysis);

      logger.info(`CodeAnalysisAgent: Analysis complete`, {
        findingCount: findings.length,
        avgSeverity: findings.reduce((a, b) => a + b.severity, 0) / findings.length
      });

      return {
        agent: 'CodeAnalysisAgent',
        status: 'completed',
        findings,
        rawAnalysis: analysis,
        codeHash: sourceCodeHash,
        analyzedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`CodeAnalysisAgent: Analysis failed`, { error: error.message });
      throw error;
    }
  }

  async _fetchCodeContext(sourceCodeHash, gitRepoUrl) {
    // Placeholder - in production, fetch from IPFS/GitHub
    return {
      sourceCodeHash,
      gitRepoUrl,
      code: '// Code would be fetched from IPFS/D存储',
      language: 'solidity',
      framework: 'hardhat'
    };
  }

  _buildAnalysisPrompt(codeContext, context) {
    return `Analyze the following smart contract code:

Source Code Hash: ${codeContext.sourceCodeHash}
${codeContext.gitRepoUrl ? `Git Repository: ${codeContext.gitRepoUrl}` : ''}

Provide a detailed security analysis including:
1. Critical vulnerabilities found ( severity 1-5, where 5 is most severe)
2. Medium severity issues
3. Informational findings
4. Overall code quality assessment
5. Specific recommendations

Format findings as JSON array with fields: type, description, severity, location, recommendation`;
  }

  _parseFindings(analysis) {
    // Try to extract structured JSON from response
    try {
      const jsonMatch = analysis.match(/\{[\s\S]*\}\s*\}|\[[\s\S]*\]\s*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // Fall through to default
    }

    // Return a structured default if parsing fails
    return [{
      type: 'analysis',
      description: analysis.substring(0, 500),
      severity: 3,
      location: 'general',
      recommendation: 'Review full analysis in rawOutput'
    }];
  }
}