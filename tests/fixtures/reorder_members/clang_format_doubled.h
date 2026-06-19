#ifndef SampleClangFormatDoubled_H
#define SampleClangFormatDoubled_H

class SampleClangFormatDoubled {
public:
    // clang-format off
    int outer_keep_first;
    // clang-format off
    int inner_keep_alpha;
    int inner_keep_beta;
    // clang-format on
    int outer_keep_last;
    // clang-format on
};

#endif
